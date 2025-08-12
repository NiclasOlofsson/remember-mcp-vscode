/**
 * Session Data Transformer - Converts chat session data to CopilotUsageEvent format
 * Bridges between session files and existing storage/analytics infrastructure
 */

import * as path from 'path';
import * as crypto from 'crypto';
import { 
	CopilotChatSession, 
	CopilotChatRequest, 
	SessionScanResult, 
	SessionMetadata 
} from '../types/chat-session';
import { CopilotUsageEvent } from '../types/usage-events';
import { ILogger } from '../types/logger';

export class SessionDataTransformer {
	constructor(
		private readonly logger: ILogger,
		private readonly extensionVersion: string
	) {}

	/**
     * Transform a complete session scan result into usage events
     */
	transformSessionScanResults(scanResults: SessionScanResult[]): CopilotUsageEvent[] {
		const allEvents: CopilotUsageEvent[] = [];
        
		for (const scanResult of scanResults) {
			try {
				const sessionEvents = this.transformSessionToEvents(scanResult);
				allEvents.push(...sessionEvents);
			} catch (error) {
				this.logger.error(`Error transforming session ${scanResult.session.sessionId}: ${error}`);
			}
		}
        
		this.logger.info(`Transformed ${scanResults.length} sessions into ${allEvents.length} events`);
		return allEvents;
	}

	/**
     * Transform a single session scan result into usage events
     */
	transformSessionToEvents(scanResult: SessionScanResult): CopilotUsageEvent[] {
		// Add defensive logging
		this.logger.trace(`transformSessionToEvents called with sessionFilePath: "${scanResult.sessionFilePath}" (type: ${typeof scanResult.sessionFilePath})`);
        
		const { session, sessionFilePath } = scanResult;
		const events: CopilotUsageEvent[] = [];
        
		// Extract workspace context from file path
		const workspaceContext = this.extractWorkspaceContext(sessionFilePath);
        
		for (const request of session.requests) {
			try {
				const event = this.transformRequestToEvent(session, request, workspaceContext);
				events.push(event);
			} catch (error) {
				this.logger.error(`Error transforming request ${request.requestId}: ${error instanceof Error ? error.stack : error}`);
			}
		}
        
		return events;
	}

	/**
     * Transform a single chat request into a usage event
     */
	private transformRequestToEvent(
		session: CopilotChatSession, 
		request: CopilotChatRequest, 
		workspaceContext: WorkspaceContext
	): CopilotUsageEvent {
		// Create deterministic event ID
		const id = this.generateEventId(session.sessionId, request.requestId);
        
		// Extract session hierarchy
		const sessionHierarchy = this.extractSessionHierarchy(session, workspaceContext);
        
		// Calculate response metrics
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const responseMetrics = this.calculateResponseMetrics(request);
        
		// Determine event type based on context
		const eventType = this.determineEventType(request);
        
		// Extract language context (if available from content references)
		const language = this.extractLanguageContext(request);
        
		const event: CopilotUsageEvent = {
			id,
			timestamp: new Date(request.timestamp).toISOString(), // Convert unix timestamp to ISO string
			type: eventType,
			source: 'copilot-chat',
            
			// Session hierarchy
			vscodeSessionId: sessionHierarchy.vscodeSessionId,
			windowId: sessionHierarchy.windowId,
			extensionHostSessionId: sessionHierarchy.extensionHostSessionId,
			sessionId: session.sessionId,
			workspaceId: workspaceContext.workspaceHash,
            
			// Event details
			duration: request.result?.timings?.totalElapsed,
			tokensUsed: this.estimateTokenUsage(request),
			model: request.modelId,
            
			// Context
			language,
			filePath: this.extractMainFilePath(request),
			userPrompt: this.shouldIncludePrompt() ? request.message.text : undefined,
            
			// Metadata
			vsCodeVersion: 'unknown', // Not available in session files
			copilotVersion: 'unknown', // Not available in session files  
			extensionVersion: this.extensionVersion
		};
        
		return event;
	}

	/**
     * Extract session metadata for analytics
     */
	extractSessionMetadata(scanResult: SessionScanResult): SessionMetadata {
		// Add defensive logging
		this.logger.trace(`extractSessionMetadata called with sessionFilePath: "${scanResult.sessionFilePath}" (type: ${typeof scanResult.sessionFilePath})`);
        
		const { session } = scanResult;
		const workspaceContext = this.extractWorkspaceContext(scanResult.sessionFilePath);
        
		// Calculate session metrics
		const requests = session.requests;
		const responseMetrics = requests.map(r => this.calculateResponseMetrics(r));
        
		const totalResponseLength = responseMetrics.reduce((sum, m) => sum + m.responseLength, 0);
		const totalResponseTime = responseMetrics.reduce((sum, m) => sum + (m.responseTime || 0), 0);
		const averageResponseTime = requests.length > 0 ? totalResponseTime / requests.length : 0;
        
		// Extract unique languages and models
		const languagesUsed = Array.from(new Set(
			requests.map(r => this.extractLanguageContext(r))
				.filter(lang => lang)
		)) as string[];
        
		const modelsUsed = Array.from(new Set(
			requests.map(r => r.modelId)
				.filter(model => model) // Filter out undefined values
		)) as string[];
        
		// Check for advanced features
		const hasCodeCitations = requests.some(r => r.codeCitations && r.codeCitations.length > 0);
		const hasContentReferences = requests.some(r => r.contentReferences && r.contentReferences.length > 0);
		const hasFollowups = requests.some(r => r.followups && r.followups.length > 0);
        
		// Determine session time range
		const timestamps = requests.map(r => new Date(r.timestamp).getTime());
		const sessionStartTime = new Date(Math.min(...timestamps)).toISOString();
		const sessionEndTime = requests.length > 1 ? new Date(Math.max(...timestamps)).toISOString() : undefined;
        
		return {
			sessionId: session.sessionId,
			workspaceHash: workspaceContext.workspaceHash,
			vscodeInstanceId: workspaceContext.workspaceHash, // Best approximation available
			sessionStartTime,
			sessionEndTime,
			requestCount: requests.length,
			totalResponseLength,
			averageResponseTime,
			languagesUsed,
			modelsUsed,
			hasCodeCitations,
			hasContentReferences,
			hasFollowups
		};
	}

	/**
     * Generate deterministic event ID from session and request IDs
     */
	private generateEventId(sessionId: string, requestId: string): string {
		const combined = `${sessionId}-${requestId}`;
		return crypto.createHash('sha256').update(combined).digest('hex').substring(0, 16);
	}

	/**
     * Extract workspace context from session file path
     */
	private extractWorkspaceContext(sessionFilePath: string): WorkspaceContext {
		// Add type guard to ensure sessionFilePath is a valid string
		if (!sessionFilePath || typeof sessionFilePath !== 'string') {
			this.logger.error(`Invalid sessionFilePath: ${sessionFilePath} (type: ${typeof sessionFilePath})`);
			return {
				workspaceHash: 'unknown',
				storagePath: 'unknown'
			};
		}
        
		// Path structure: .../workspaceStorage/{workspaceHash}/chatSessions/sessionFile.json
		const pathParts = sessionFilePath.split(path.sep);
		const workspaceStorageIndex = pathParts.findIndex(part => part === 'workspaceStorage');
        
		let workspaceHash = 'unknown';
		if (workspaceStorageIndex >= 0 && workspaceStorageIndex < pathParts.length - 2) {
			workspaceHash = pathParts[workspaceStorageIndex + 1];
		}
        
		return {
			workspaceHash,
			storagePath: sessionFilePath
		};
	}

	/**
     * Extract session hierarchy information 
     */
	private extractSessionHierarchy(session: CopilotChatSession, workspaceContext: WorkspaceContext): SessionHierarchy {
		// Generate IDs based on available data
		// VS Code session files don't contain full hierarchy, so we'll construct reasonable approximations
        
		const sessionDate = new Date(session.creationDate); // creationDate is now a number (timestamp)
		const dateString = sessionDate.toISOString().substring(0, 13).replace(/[-:T]/g, ''); // YYYYMMDDHH
        
		return {
			vscodeSessionId: `vscode-${dateString}`, // Approximate based on creation date
			windowId: `window-${workspaceContext.workspaceHash.substring(0, 8)}`, // Derive from workspace
			extensionHostSessionId: `exthost-${session.sessionId.substring(0, 8)}` // Derive from session ID
		};
	}

	/**
     * Calculate response metrics from a request
     */
	private calculateResponseMetrics(request: CopilotChatRequest): ResponseMetrics {
		const responseLength = request.response 
			? request.response.reduce((total, item) => total + (item.value?.length || 0), 0)
			: 0;
            
		const responseTime = request.result?.timings?.totalElapsed || 0;
		const firstProgressTime = request.result?.timings?.firstProgress || 0;
        
		return {
			responseLength,
			responseTime,
			firstProgressTime,
			codeCitationCount: request.codeCitations?.length || 0,
			contentReferenceCount: request.contentReferences?.length || 0,
			followupCount: request.followups?.length || 0
		};
	}

	/**
     * Determine event type based on request characteristics
     */
	private determineEventType(request: CopilotChatRequest): 'chat' | 'completion' | 'edit' | 'explain' {
		// Check agent type first
		if (request.agent?.id) {
			if (request.agent.id.includes('editsAgent')) {
				return 'edit';
			}
			if (request.agent.id.includes('explainAgent')) {
				return 'explain';
			}
		}

		// Check message content for slash commands or patterns
		const messageText = request.message?.text?.toLowerCase() || '';
		
		// Look for edit-related patterns
		if (messageText.includes('/edit') || 
			messageText.includes('modify') || 
			messageText.includes('change') ||
			messageText.includes('update') ||
			messageText.includes('fix')) {
			return 'edit';
		}
		
		// Look for explain-related patterns
		if (messageText.includes('/explain') || 
			messageText.includes('explain') ||
			messageText.includes('what does') ||
			messageText.includes('how does') ||
			messageText.includes('describe')) {
			return 'explain';
		}
		
		// Look for completion-related patterns (inline completions, suggestions)
		if (messageText.includes('complete') ||
			messageText.includes('suggest') ||
			messageText.includes('autocomplete')) {
			return 'completion';
		}
		
		// Default to 'chat' for general conversation
		return 'chat';
	}

	/**
     * Extract language context from content references
     */
	private extractLanguageContext(request: CopilotChatRequest): string | undefined {
		// Debug: Log what we're working with
		this.logger.trace(`Extracting language context for request ${request.requestId}`);
		this.logger.trace(`Content references count: ${request.contentReferences?.length || 0}`);
		
		// 1. Try content references first (current method)
		if (request.contentReferences && request.contentReferences.length > 0) {
			for (const ref of request.contentReferences) {
				this.logger.trace('Processing content reference:', ref);
				
				// Get file path from multiple possible fields (VS Code stores the path in different ways)
				let filePath: string | undefined;
				
				if (ref.reference?.uri && typeof ref.reference.uri === 'string') {
					filePath = ref.reference.uri;
					this.logger.trace(`Using URI field: ${filePath}`);
				} else if (ref.reference?.fsPath && typeof ref.reference.fsPath === 'string') {
					filePath = ref.reference.fsPath;
					this.logger.trace(`Using fsPath field: ${filePath}`);
				} else if (ref.reference?.path && typeof ref.reference.path === 'string') {
					filePath = ref.reference.path;
					this.logger.trace(`Using path field: ${filePath}`);
				} else if (ref.reference?.external && typeof ref.reference.external === 'string') {
					filePath = ref.reference.external;
					this.logger.trace(`Using external field: ${filePath}`);
				} else {
					this.logger.trace('Content reference has no usable file path field');
					continue;
				}
				
				// Skip if no valid file path found
				if (!filePath) {
					this.logger.trace('No valid file path found in content reference');
					continue;
				}
				
				// Extract extension and map to language
				const ext = path.extname(filePath).toLowerCase();
				this.logger.trace(`Extracted extension: ${ext} from ${filePath}`);
				
				const language = this.mapExtensionToLanguage(ext);
				if (language) {
					this.logger.trace(`Mapped extension ${ext} to language: ${language}`);
					return language;
				} else {
					this.logger.trace(`No language mapping found for extension: ${ext}`);
				}
			}
		}
		
		// 2. Try variableData if no language found from content references
		if (request.variableData?.variables) {
			this.logger.trace('Checking variableData.variables for file information');
			const languageFromVariables = this.extractLanguageFromVariables(request.variableData.variables);
			if (languageFromVariables) {
				this.logger.trace(`Detected language from variables: ${languageFromVariables}`);
				return languageFromVariables;
			}
		}
		
		// 3. Try message parts if still no language found
		if (request.message?.parts) {
			this.logger.trace('Checking message.parts for file information');
			const languageFromParts = this.extractLanguageFromMessageParts(request.message.parts);
			if (languageFromParts) {
				this.logger.trace(`Detected language from message parts: ${languageFromParts}`);
				return languageFromParts;
			}
		}
		
		// 4. Fallback: Try to detect language from message content
		const messageLanguage = this.detectLanguageFromMessage(request.message.text);
		if (messageLanguage) {
			this.logger.trace(`Fallback: Detected language from message content: ${messageLanguage}`);
			return messageLanguage;
		}
        
		this.logger.trace(`No language detected for request ${request.requestId}`);
		return undefined;
	}

	/**
	 * Map file extension to language
	 */
	private mapExtensionToLanguage(ext: string): string | undefined {
		const languageMap: Record<string, string> = {
			'.ts': 'typescript',
			'.tsx': 'typescript',
			'.js': 'javascript',
			'.jsx': 'javascript',
			'.mjs': 'javascript',
			'.py': 'python',
			'.pyw': 'python',
			'.java': 'java',
			'.cs': 'csharp',
			'.cpp': 'cpp',
			'.cxx': 'cpp',
			'.cc': 'cpp',
			'.c': 'c',
			'.h': 'c',
			'.hpp': 'cpp',
			'.go': 'go',
			'.rs': 'rust',
			'.php': 'php',
			'.rb': 'ruby',
			'.swift': 'swift',
			'.kt': 'kotlin',
			'.scala': 'scala',
			'.sql': 'sql',
			'.html': 'html',
			'.htm': 'html',
			'.css': 'css',
			'.scss': 'scss',
			'.sass': 'scss',
			'.json': 'json',
			'.xml': 'xml',
			'.md': 'markdown',
			'.yml': 'yaml',
			'.yaml': 'yaml',
			'.sh': 'bash',
			'.bash': 'bash',
			'.zsh': 'bash',
			'.ps1': 'powershell',
			'.vue': 'vue',
			'.svelte': 'svelte'
		};
		
		return languageMap[ext];
	}

	/**
	 * Extract language from variable data
	 */
	private extractLanguageFromVariables(variables: any[]): string | undefined {
		for (const variable of variables) {
			// Check if variable has file path information
			if (variable.reference?.uri) {
				const ext = path.extname(variable.reference.uri).toLowerCase();
				const language = this.mapExtensionToLanguage(ext);
				if (language) {
					return language;
				}
			}
			if (variable.reference?.fsPath) {
				const ext = path.extname(variable.reference.fsPath).toLowerCase();
				const language = this.mapExtensionToLanguage(ext);
				if (language) {
					return language;
				}
			}
		}
		return undefined;
	}

	/**
	 * Extract language from message parts
	 */
	private extractLanguageFromMessageParts(parts: any[]): string | undefined {
		for (const part of parts) {
			// Check if part has file reference
			if (part.references) {
				for (const ref of part.references) {
					if (ref.uri) {
						const ext = path.extname(ref.uri).toLowerCase();
						const language = this.mapExtensionToLanguage(ext);
						if (language) {
							return language;
						}
					}
					if (ref.fsPath) {
						const ext = path.extname(ref.fsPath).toLowerCase();
						const language = this.mapExtensionToLanguage(ext);
						if (language) {
							return language;
						}
					}
				}
			}
			// Check if part text contains file paths
			if (part.text && typeof part.text === 'string') {
				const filePathMatch = part.text.match(/(['"`])([^'"`]*\.\w+)\1/);
				if (filePathMatch) {
					const ext = path.extname(filePathMatch[2]).toLowerCase();
					const language = this.mapExtensionToLanguage(ext);
					if (language) {
						return language;
					}
				}
			}
		}
		return undefined;
	}

	/**
	 * Fallback language detection from message content
	 */
	private detectLanguageFromMessage(messageText: string): string | undefined {
		if (!messageText) {
			return undefined;
		}
		
		const text = messageText.toLowerCase();
		
		// Look for language-specific keywords or patterns
		const languagePatterns: Record<string, RegExp[]> = {
			'typescript': [/\btypescript\b/, /\b\.ts\b/, /\binterface\b/, /\btype\s+\w+\s*=/, /\bas\s+\w+/],
			'javascript': [/\bjavascript\b/, /\b\.js\b/, /\bconst\s+\w+\s*=/, /\bfunction\s*\(/, /\b=>\s*/],
			'python': [/\bpython\b/, /\b\.py\b/, /\bdef\s+\w+\s*\(/, /\bimport\s+\w+/, /\bfrom\s+\w+\s+import/],
			'java': [/\bjava\b/, /\b\.java\b/, /\bpublic\s+class/, /\bpublic\s+static\s+void\s+main/],
			'csharp': [/\bc#\b/, /\bcsharp\b/, /\b\.cs\b/, /\bpublic\s+class/, /\busing\s+System/],
			'go': [/\bgolang\b/, /\b\.go\b/, /\bfunc\s+\w+\s*\(/, /\bpackage\s+main/],
			'rust': [/\brust\b/, /\b\.rs\b/, /\bfn\s+\w+\s*\(/, /\blet\s+mut/],
			'sql': [/\bsql\b/, /\bselect\s+/, /\bfrom\s+\w+/, /\bwhere\s+/, /\binsert\s+into/],
			'html': [/\bhtml\b/, /\b<\/?\w+/, /\b\.html\b/],
			'css': [/\bcss\b/, /\b\.css\b/, /\{\s*\w+\s*:/, /\bcolor\s*:/],
			'markdown': [/\bmarkdown\b/, /\b\.md\b/, /\b#+\s/, /\[.*\]\(.*\)/]
		};
		
		for (const [language, patterns] of Object.entries(languagePatterns)) {
			if (patterns.some(pattern => pattern.test(text))) {
				return language;
			}
		}
		
		return undefined;
	}

	/**
     * Extract the main file path from content references
     */
	private extractMainFilePath(request: CopilotChatRequest): string | undefined {
		if (!request.contentReferences || request.contentReferences.length === 0) {
			return undefined;
		}
        
		// Return the first content reference file path (anonymized)
		const firstRef = request.contentReferences[0];
		if (firstRef.reference) {
			// Get file path from multiple possible fields (VS Code stores the path in different ways)
			let filePath: string | undefined;
			
			if (firstRef.reference.uri && typeof firstRef.reference.uri === 'string') {
				filePath = firstRef.reference.uri;
			} else if (firstRef.reference.fsPath && typeof firstRef.reference.fsPath === 'string') {
				filePath = firstRef.reference.fsPath;
			} else if (firstRef.reference.path && typeof firstRef.reference.path === 'string') {
				filePath = firstRef.reference.path;
			} else if (firstRef.reference.external && typeof firstRef.reference.external === 'string') {
				filePath = firstRef.reference.external;
			}
			
			if (filePath) {
				// Anonymize the path by keeping only the filename and extension
				const fileName = path.basename(filePath);
				return fileName;
			}
		}
        
		return undefined;
	}

	/**
     * Estimate token usage from request/response content
     */
	private estimateTokenUsage(request: CopilotChatRequest): number {
		// Rough estimation: ~4 characters per token for English text
		const messageLength = request.message.text?.length || 0;
		const responseLength = request.response 
			? request.response.reduce((total, item) => total + (item.value?.length || 0), 0)
			: 0;
        
		const totalCharacters = messageLength + responseLength;
		return Math.round(totalCharacters / 4);
	}

	/**
     * Check if user prompts should be included (privacy setting)
     */
	private shouldIncludePrompt(): boolean {
		// This would typically check a privacy setting
		// For now, default to not including prompts for privacy
		return false;
	}
}

// Helper interfaces
interface WorkspaceContext {
	workspaceHash: string;
	storagePath: string;
}

interface SessionHierarchy {
	vscodeSessionId: string;
	windowId: string;
	extensionHostSessionId: string;
}

interface ResponseMetrics {
	responseLength: number;
	responseTime: number;
	firstProgressTime: number;
	codeCitationCount: number;
	contentReferenceCount: number;
	followupCount: number;
}
