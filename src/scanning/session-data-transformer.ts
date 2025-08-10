/**
 * Session Data Transformer - Converts chat session data to CopilotUsageEvent format
 * Bridges between session files and existing storage/analytics infrastructure
 */

import * as vscode from 'vscode';
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
                this.logger.appendLine(`[SessionTransformer] Error transforming session ${scanResult.session.sessionId}: ${error}`);
            }
        }
        
        this.logger.appendLine(`[SessionTransformer] Transformed ${scanResults.length} sessions into ${allEvents.length} events`);
        return allEvents;
    }

    /**
     * Transform a single session scan result into usage events
     */
    transformSessionToEvents(scanResult: SessionScanResult): CopilotUsageEvent[] {
        // Add defensive logging
        this.logger.appendLine(`[SessionTransformer] transformSessionToEvents called with sessionFilePath: "${scanResult.sessionFilePath}" (type: ${typeof scanResult.sessionFilePath})`);
        
        const { session, sessionFilePath } = scanResult;
        const events: CopilotUsageEvent[] = [];
        
        // Extract workspace context from file path
        const workspaceContext = this.extractWorkspaceContext(sessionFilePath);
        
        for (const request of session.requests) {
            try {
                const event = this.transformRequestToEvent(session, request, workspaceContext);
                events.push(event);
            } catch (error) {
                this.logger.appendLine(`[SessionTransformer] Error transforming request ${request.requestId}: ${error}`);
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
        this.logger.appendLine(`[SessionTransformer] extractSessionMetadata called with sessionFilePath: "${scanResult.sessionFilePath}" (type: ${typeof scanResult.sessionFilePath})`);
        
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
            this.logger.appendLine(`[SessionTransformer] Invalid sessionFilePath: ${sessionFilePath} (type: ${typeof sessionFilePath})`);
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
        // Default to 'chat' since these are chat session files
        // Could be enhanced to detect specific patterns in the future
        return 'chat';
    }

    /**
     * Extract language context from content references
     */
    private extractLanguageContext(request: CopilotChatRequest): string | undefined {
        if (!request.contentReferences || request.contentReferences.length === 0) {
            return undefined;
        }
        
        // Try to infer language from file extensions in content references
        for (const ref of request.contentReferences) {
            if (ref.reference?.uri) {
                const filePath = ref.reference.uri;
                const ext = path.extname(filePath).toLowerCase();
                
                const languageMap: Record<string, string> = {
                    '.ts': 'typescript',
                    '.js': 'javascript',
                    '.py': 'python',
                    '.java': 'java',
                    '.cs': 'csharp',
                    '.cpp': 'cpp',
                    '.c': 'c',
                    '.go': 'go',
                    '.rs': 'rust',
                    '.php': 'php',
                    '.rb': 'ruby',
                    '.swift': 'swift',
                    '.kt': 'kotlin',
                    '.scala': 'scala',
                    '.sql': 'sql',
                    '.html': 'html',
                    '.css': 'css',
                    '.scss': 'scss',
                    '.json': 'json',
                    '.xml': 'xml',
                    '.md': 'markdown'
                };
                
                if (languageMap[ext]) {
                    return languageMap[ext];
                }
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
        
        // Return the first content reference URI (anonymized)
        const firstRef = request.contentReferences[0];
        if (firstRef.reference?.uri) {
            // Anonymize the path by keeping only the filename and extension
            const fileName = path.basename(firstRef.reference.uri);
            return fileName;
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
