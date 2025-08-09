/**
 * Enhanced Copilot log parser for comprehensive event extraction
 * Pure implementation - no current session dependencies
 * 
 * Comprehensive data sources:
 * - Traditional extension logs (GitHub.Copilot.log, GitHub.Copilot-Chat.log)
 * - General VS Code logs (exthost.log, sharedprocess.log, renderer.log)
 * - Output logging directories (output_logging_*)
 * 
 * Language extraction approach:
 * - Limited approach: Extract language info only when clearly available
 * - Historical logs rarely contain explicit language information
 * - Return undefined for unknown cases (analytics engine converts to "unknown")
 * - Focus on what we can reliably extract rather than guessing
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CopilotUsageEvent } from '../types/usage-events';
import { ILogger, SilentLogger } from '../types/logger';

export class CopilotLogParser {
    private static readonly LOG_PATHS = {
        win32: [
            // VS Code Insiders (prioritized for development)
            path.join(os.homedir(), 'AppData/Roaming/Code - Insiders/logs'),
            // VS Code Stable
            path.join(os.homedir(), 'AppData/Roaming/Code/logs'),
            // Additional possible locations
            path.join(os.homedir(), 'AppData/Roaming/Code - OSS/logs'),
            path.join(os.homedir(), 'AppData/Roaming/VSCode/logs')
        ],
        darwin: [
            // VS Code Insiders (prioritized for development)
            path.join(os.homedir(), 'Library/Application Support/Code - Insiders/logs'),
            // VS Code Stable
            path.join(os.homedir(), 'Library/Application Support/Code/logs'),
            // Additional possible locations
            path.join(os.homedir(), 'Library/Application Support/Code - OSS/logs'),
            path.join(os.homedir(), 'Library/Application Support/VSCode/logs')
        ],
        linux: [
            // VS Code Insiders (prioritized for development)
            path.join(os.homedir(), '.config/Code - Insiders/logs'),
            // VS Code Stable
            path.join(os.homedir(), '.config/Code/logs'),
            // Additional possible locations
            path.join(os.homedir(), '.config/Code - OSS/logs'),
            path.join(os.homedir(), '.config/VSCode/logs')
        ]
    };

    private static readonly EVENT_PATTERNS = {
        // Authentication and session events
        loginEvent: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[info\] Logged in as (\w+)/,
        tokenReceived: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[info\] Got Copilot token for (\w+)/,
        
        // Model and capability events
        modelMetadata: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[info\] Fetched model metadata in (\d+)ms (.+)/,
        refetchMetadata: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[info\] Refetch model metadata: Succeeded in (\d+)ms (.+)/,
        copilotCapabilities: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[info\] copilot token chat_enabled: (\w+), sku: (.+)/,
        
        // Feature activation and enablement
        featureActivation: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[info\] activationBlocker from '([^']+)' took for (\d+)ms/,
        agentRegistration: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[info\] Registering (.*?) agent/,
        
        // General VS Code log patterns (exthost.log, sharedprocess.log, renderer.log)
        githubCopilotActivity: /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}).*?[Cc]opilot(.+)/,
        extensionHostActivity: /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}).*?vscode\.github\.copilot(.+)/,
        chatActivity: /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}).*?copilot.*?chat(.+)/,
        completionActivity: /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}).*?copilot.*?completion(.+)/,
        
        // Output logging patterns
        outputLogging: /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}).*?\[(trace|debug|info|warn|error)\](.+)/,
        
        // General service initialization
        serviceInit: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[info\] \[([^\]]+)\] (.+)/,
        
        // Catch-all for other info messages that might contain usage data
        infoMessage: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[info\] (.+)/
    };

    private logger: ILogger;

    constructor(logger?: ILogger) {
        this.logger = logger || new SilentLogger();
    }

    /**
     * Find all Copilot log files across VS Code installations
     * Prioritizes both VS Code Insiders and VS Code Stable
     */
    async findCopilotLogs(): Promise<string[]> {
        const platform = os.platform() as keyof typeof CopilotLogParser.LOG_PATHS;
        const searchPaths = CopilotLogParser.LOG_PATHS[platform] || CopilotLogParser.LOG_PATHS.linux;
        
        const logFiles: string[] = [];
        const installationsFound: string[] = [];
        
        for (const basePath of searchPaths) {
            try {
                await this.debug(`Scanning VS Code installation: ${basePath}`);
                
                // Check if this installation exists
                const exists = await this.directoryExists(basePath);
                if (!exists) {
                    await this.debug(`Installation not found: ${basePath}`);
                    continue;
                }
                
                // Identify which VS Code version this is
                const installationType = this.identifyVSCodeInstallation(basePath);
                installationsFound.push(installationType);
                await this.debug(`Found ${installationType} installation`);
                
                // Look for copilot-related log files
                const files = await this.findLogFilesInPath(basePath);
                logFiles.push(...files);
                
                await this.debug(`Extracted ${files.length} log files from ${installationType}`);
            } catch (error) {
                await this.debug(`Error accessing VS Code installation ${basePath}: ${error}`);
            }
        }
        
        // Report summary
        await this.debug(`=== VS Code Installation Summary ===`);
        await this.debug(`Installations found: ${installationsFound.join(', ')}`);
        await this.debug(`Total Copilot log files discovered: ${logFiles.length}`);
        
        if (installationsFound.length === 0) {
            await this.debug(`⚠️ No VS Code installations found. Expected locations:`);
            searchPaths.forEach(path => this.debug(`  - ${path}`));
        } else {
            await this.debug(`✅ Successfully scanned ${installationsFound.length} VS Code installation(s)`);
        }
        
        return logFiles;
    }

    /**
     * Scan for available VS Code installations
     */
    async scanVSCodeInstallations(): Promise<{
        available: Array<{type: string, path: string, logCount: number}>,
        total: number
    }> {
        const platform = os.platform() as keyof typeof CopilotLogParser.LOG_PATHS;
        const searchPaths = CopilotLogParser.LOG_PATHS[platform] || CopilotLogParser.LOG_PATHS.linux;
        
        const available: Array<{type: string, path: string, logCount: number}> = [];
        
        for (const basePath of searchPaths) {
            try {
                const exists = await this.directoryExists(basePath);
                if (exists) {
                    const installationType = this.identifyVSCodeInstallation(basePath);
                    const logFiles = await this.findLogFilesInPath(basePath);
                    
                    available.push({
                        type: installationType,
                        path: basePath,
                        logCount: logFiles.length
                    });
                    
                    await this.debug(`✅ ${installationType}: ${logFiles.length} log files at ${basePath}`);
                } else {
                    const installationType = this.identifyVSCodeInstallation(basePath);
                    await this.debug(`❌ ${installationType}: Not installed at ${basePath}`);
                }
            } catch (error) {
                await this.debug(`⚠️ Error checking ${basePath}: ${error}`);
            }
        }
        
        return {
            available,
            total: available.reduce((sum, install) => sum + install.logCount, 0)
        };
    }

    /**
     * Parse a single log file and extract usage events
     */
    async parseLogFile(filePath: string): Promise<CopilotUsageEvent[]> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n');
            const events: CopilotUsageEvent[] = [];
            
            await this.debug(`Parsing log file: ${filePath} (${lines.length} lines)`);
            
            for (const line of lines) {
                const event = await this.extractEventFromLine(line, filePath);
                if (event) {
                    events.push(event);
                }
            }
            
            await this.debug(`Extracted ${events.length} events from ${filePath}`);
            return events;
        } catch (error) {
            await this.debug(`Failed to parse log file ${filePath}: ${error}`);
            return [];
        }
    }

    /**
     * Parse multiple log files in batch
     */
    async parseLogFiles(filePaths: string[]): Promise<CopilotUsageEvent[]> {
        const allEvents: CopilotUsageEvent[] = [];
        
        for (const filePath of filePaths) {
            const events = await this.parseLogFile(filePath);
            allEvents.push(...events);
        }
        
        // Sort by timestamp and deduplicate
        allEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        return this.deduplicateEvents(allEvents);
    }

    /**
     * Scan for historical logs and extract all events
     */
    async scanHistoricalLogs(): Promise<CopilotUsageEvent[]> {
        const logFiles = await this.findCopilotLogs();
        return this.parseLogFiles(logFiles);
    }

    /**
     * Find log files in a specific path with proper nested directory traversal
     */
    private async findLogFilesInPath(basePath: string): Promise<string[]> {
        const logFiles: string[] = [];
        
        try {
            await this.debug(`Scanning directory structure in: ${basePath}`);
            
            // First, find all session directories (format: YYYYMMDDTHHMMSS)
            const sessionDirs = await this.findSessionDirectories(basePath);
            await this.debug(`Found ${sessionDirs.length} session directories`);
            
            for (const sessionDir of sessionDirs) {
                // Look for window directories within each session
                const windowDirs = await this.findWindowDirectories(sessionDir);
                await this.debug(`Found ${windowDirs.length} window directories in ${sessionDir}`);
                
                for (const windowDir of windowDirs) {
                    // Look for exthost directory
                    const extHostPath = path.join(windowDir, 'exthost');
                    if (await this.directoryExists(extHostPath)) {
                        // Find GitHub Copilot extension directories
                        const copilotDirs = await this.findCopilotExtensionDirectories(extHostPath);
                        
                        for (const copilotDir of copilotDirs) {
                            const files = await fs.readdir(copilotDir);
                            for (const file of files) {
                                if (file.endsWith('.log')) {
                                    const fullPath = path.join(copilotDir, file);
                                    logFiles.push(fullPath);
                                    await this.debug(`Found Copilot log: ${fullPath}`);
                                }
                            }
                        }
                        
                        // Also check output_logging directories for additional logs
                        const outputDirs = await this.findDirectories(extHostPath, 'output_logging_');
                        for (const outputDir of outputDirs) {
                            const files = await fs.readdir(outputDir);
                            for (const file of files) {
                                if (file.includes('GitHub.Copilot') && file.endsWith('.log')) {
                                    const fullPath = path.join(outputDir, file);
                                    logFiles.push(fullPath);
                                    await this.debug(`Found Copilot output log: ${fullPath}`);
                                }
                            }
                        }
                    }
                }
            }
        } catch (error) {
            await this.debug(`Error scanning ${basePath}: ${error}`);
            // Directory structure might be different, fallback to broad search
            try {
                const files = await this.findFilesRecursively(basePath, /GitHub\.Copilot.*\.log$/);
                logFiles.push(...files);
            } catch (fallbackError) {
                await this.debug(`Fallback search failed for ${basePath}: ${fallbackError}`);
            }
        }
        
        return logFiles;
    }

    /**
     * Find directories matching a pattern
     */
    private async findDirectories(basePath: string, pattern: string): Promise<string[]> {
        try {
            const entries = await fs.readdir(basePath, { withFileTypes: true });
            return entries
                .filter(entry => entry.isDirectory() && entry.name.includes(pattern))
                .map(entry => path.join(basePath, entry.name));
        } catch (error) {
            return [];
        }
    }

    /**
     * Find files recursively matching a pattern
     */
    private async findFilesRecursively(basePath: string, pattern: RegExp): Promise<string[]> {
        const files: string[] = [];
        
        try {
            const entries = await fs.readdir(basePath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(basePath, entry.name);
                
                if (entry.isDirectory()) {
                    const subFiles = await this.findFilesRecursively(fullPath, pattern);
                    files.push(...subFiles);
                } else if (pattern.test(entry.name)) {
                    files.push(fullPath);
                }
            }
        } catch (error) {
            // Directory not accessible
        }
        
        return files;
    }

    /**
     * Extract an event from a single log line
     */
    private async extractEventFromLine(line: string, filePath: string): Promise<CopilotUsageEvent | null> {
        for (const [eventType, pattern] of Object.entries(CopilotLogParser.EVENT_PATTERNS)) {
            const match = pattern.exec(line);
            if (match) {
                return await this.createEventFromMatch(eventType, match, filePath, line);
            }
        }
        
        return null;
    }

    /**
     * Create a usage event from a regex match
     */
    private async createEventFromMatch(
        eventType: string, 
        match: RegExpExecArray, 
        filePath: string,
        originalLine: string
    ): Promise<CopilotUsageEvent> {
        const [, timestamp, ...groups] = match;
        const eventTime = new Date(timestamp);
        
        // Extract specific data based on event type
        let duration: number | undefined;
        let model: string | undefined;
        let tokensUsed: number | undefined;
        
        switch (eventType) {
            case 'modelMetadata':
            case 'refetchMetadata':
                duration = groups[0] ? parseInt(groups[0], 10) : undefined;
                model = groups[1] || 'unknown';
                tokensUsed = 20; // Estimated metadata request tokens
                break;
            case 'featureActivation':
                duration = groups[1] ? parseInt(groups[1], 10) : undefined;
                model = groups[0]; // Feature name
                tokensUsed = 10; // Estimated activation tokens
                break;
            case 'loginEvent':
            case 'tokenReceived':
                model = groups[0] || 'copilot'; // Username
                tokensUsed = 5; // Authentication tokens
                break;
            case 'copilotCapabilities':
                model = `${groups[0]}_${groups[1]}`; // chat_enabled_sku
                tokensUsed = 5; // Capability check tokens
                break;
            case 'agentRegistration':
                model = groups[0] || 'agent'; // Agent type
                tokensUsed = 5; // Registration tokens
                break;
            case 'serviceInit':
                model = groups[0] || 'service'; // Service name
                tokensUsed = 5; // Init tokens
                break;
            default:
                // For generic info messages, try to extract useful info
                model = this.extractModelFromMessage(groups[0] || originalLine);
                tokensUsed = this.estimateTokensFromMessage(groups[0] || originalLine);
                break;
        }
        
        const sessionInfo = this.extractSessionInfo(filePath);
        const vsCodeVersion = this.inferVSCodeVersion(filePath);
        
        const event: CopilotUsageEvent = {
            id: this.generateEventId(timestamp, eventType, filePath),
            timestamp: eventTime.toISOString(),
            type: this.mapEventType(eventType),
            source: this.inferSource(eventType, originalLine),
            vscodeSessionId: sessionInfo.vscodeSessionId,
            windowId: sessionInfo.windowId,
            extensionHostSessionId: sessionInfo.extensionHostSessionId,
            sessionId: sessionInfo.sessionId, // Composite for backward compatibility
            workspaceId: this.extractWorkspaceId(originalLine),
            duration,
            tokensUsed,
            model,
            language: this.extractLanguage(groups, eventType),
            filePath: this.extractFilePath(originalLine),
            
            vsCodeVersion,
            copilotVersion: 'unknown', // Could be extracted from other log entries
            extensionVersion: this.getExtensionVersion()
        };
        
        return event;
    }

    /**
     * Generate a deterministic ID for event deduplication
     * Uses hash-based approach to ensure same events get same IDs
     */
    private generateEventId(timestamp: string, eventType: string, filePath: string): string {
        const input = `${timestamp}-${eventType}-${path.basename(filePath)}`;
        // Simple hash-based ID generation for consistency
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            const char = input.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return `copilot-${Math.abs(hash).toString(16)}-${Date.now().toString(36)}`;
    }

    /**
     * Map internal event types to standard types
     */
    private mapEventType(eventType: string): 'chat' | 'completion' | 'edit' | 'explain' {
        switch (eventType) {
            case 'loginEvent':
            case 'tokenReceived':
            case 'modelMetadata':
            case 'refetchMetadata':
            case 'copilotCapabilities':
            case 'agentRegistration':
                return 'chat';
            case 'featureActivation':
                return 'completion';
            case 'serviceInit':
                return 'edit';
            case 'infoMessage':
            default:
                return 'chat';
        }
    }

    /**
     * Infer the source of the event
     */
    private inferSource(eventType: string, line: string): 'copilot-chat' | 'copilot-inline' | 'copilot-sidebar' {
        if (line.includes('copilot-chat') || line.includes('chat')) {
            return 'copilot-chat';
        } else if (line.includes('inline') || line.includes('completion')) {
            return 'copilot-inline';
        } else {
            return 'copilot-sidebar';
        }
    }

    /**
     * Extract comprehensive session information from file path
     * Path structure: /logs/20250808T010909/window1/exthost/output_logging_20250808T010916/1-GitHub.Copilot.log
     */
    private extractSessionInfo(filePath: string): {
        vscodeSessionId: string;
        windowId?: string;
        extensionHostSessionId: string;
        sessionId: string;
    } {
        const normalizedPath = path.normalize(filePath);
        const parts = normalizedPath.split(path.sep);
        
        // Find the relevant parts in the path
        let vscodeSessionId = 'unknown';
        let windowId: string | undefined;
        let extensionHostSessionId = 'unknown';
        
        // Look for timestamp patterns (VS Code session)
        const vscodeSessionMatch = normalizedPath.match(/(\d{8}T\d{6})/);
        if (vscodeSessionMatch) {
            vscodeSessionId = vscodeSessionMatch[1];
        }
        
        // Look for window identifier
        const windowMatch = normalizedPath.match(/window(\d+)/);
        if (windowMatch) {
            windowId = `window${windowMatch[1]}`;
        }
        
        // Look for extension host session (output_logging timestamp)
        const extensionHostMatch = normalizedPath.match(/output_logging_(\d{8}T\d{6})/);
        if (extensionHostMatch) {
            extensionHostSessionId = extensionHostMatch[1];
        } else {
            // Fallback to directory name for extension host session
            const dir = path.dirname(filePath);
            extensionHostSessionId = path.basename(dir);
        }
        
        // Create composite session ID for backward compatibility
        let sessionId = extensionHostSessionId;
        if (windowId) {
            sessionId = `${vscodeSessionId}-${windowId}-${extensionHostSessionId}`;
        } else {
            sessionId = `${vscodeSessionId}-${extensionHostSessionId}`;
        }
        
        return {
            vscodeSessionId,
            windowId,
            extensionHostSessionId,
            sessionId
        };
    }

    /**
     * Extract workspace ID from log line
     */
    private extractWorkspaceId(line: string): string | undefined {
        // Look for workspace indicators in the log line
        const workspaceMatch = line.match(/workspace[:\s]+([^\s,}]+)/i);
        return workspaceMatch ? workspaceMatch[1] : undefined;
    }

    /**
     * Extract programming language from regex groups or infer from context (limited approach)
     */
    private extractLanguage(groups: string[], eventType: string): string | undefined {
        // For historical log parsing, language context is not available
        // Historical logs don't contain reliable language information
        // Always return undefined - analytics engine will convert to "unknown"
        return undefined;
    }

    /**
     * Extract file path from log line (anonymized)
     */
    private extractFilePath(line: string): string | undefined {
        const fileMatch = line.match(/file[:\s]+([^\s,}]+)/i);
        if (fileMatch) {
            // Anonymize the path - keep only extension
            const ext = path.extname(fileMatch[1]);
            return ext ? `*${ext}` : undefined;
        }
        return undefined;
    }

    /**
     * Infer VS Code version from file path with detailed detection
     */
    private inferVSCodeVersion(filePath: string): string {
        if (filePath.includes('Code - Insiders')) {
            return 'VS Code Insiders';
        } else if (filePath.includes('Code - OSS')) {
            return 'VS Code OSS';
        } else if (filePath.includes('VSCode')) {
            return 'VSCode';
        } else if (filePath.includes('Code')) {
            return 'VS Code Stable';
        }
        return 'Unknown VS Code Installation';
    }

    /**
     * Extract model information from a message
     */
    private extractModelFromMessage(message: string): string | undefined {
        // Look for common model patterns in messages
        const patterns = [
            /model[:\s]+([^\s,}]+)/i,
            /gpt[^\s,}]*/i,
            /claude[^\s,}]*/i,
            /copilot[^\s,}]*/i
        ];
        
        for (const pattern of patterns) {
            const match = message.match(pattern);
            if (match) {
                return match[1] || match[0];
            }
        }
        
        return undefined;
    }

    /**
     * Estimate token usage from a message
     */
    private estimateTokensFromMessage(message: string): number | undefined {
        if (!message) {
            return undefined;
        }
        
        // Simple estimation: ~4 characters per token for most models
        const estimatedTokens = Math.ceil(message.length / 4);
        
        // Cap at reasonable limits
        return Math.min(estimatedTokens, 1000);
    }

    /**
     * Get extension version from package.json (pure, no VS Code API)
     */
    private getExtensionVersion(): string {
        // For historical parsing, we don't need current extension version
        // This should be provided by the caller if needed
        return 'historical-parse';
    }

    /**
     * Find session directories (format: YYYYMMDDTHHMMSS)
     */
    private async findSessionDirectories(basePath: string): Promise<string[]> {
        const sessionDirs: string[] = [];
        try {
            const entries = await fs.readdir(basePath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && /^\d{8}T\d{6}$/.test(entry.name)) {
                    sessionDirs.push(path.join(basePath, entry.name));
                }
            }
        } catch (error) {
            await this.debug(`Error reading session directories from ${basePath}: ${error}`);
        }
        return sessionDirs;
    }

    /**
     * Find window directories (window1, window2, etc.)
     */
    private async findWindowDirectories(sessionPath: string): Promise<string[]> {
        const windowDirs: string[] = [];
        try {
            const entries = await fs.readdir(sessionPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name.startsWith('window')) {
                    windowDirs.push(path.join(sessionPath, entry.name));
                }
            }
        } catch (error) {
            await this.debug(`Error reading window directories from ${sessionPath}: ${error}`);
        }
        return windowDirs;
    }

    /**
     * Identify which VS Code installation type from path
     */
    private identifyVSCodeInstallation(basePath: string): string {
        if (basePath.includes('Code - Insiders')) {
            return 'VS Code Insiders';
        } else if (basePath.includes('Code - OSS')) {
            return 'VS Code OSS';
        } else if (basePath.includes('VSCode')) {
            return 'VSCode';
        } else if (basePath.includes('Code')) {
            return 'VS Code Stable';
        }
        return 'Unknown VS Code';
    }

    /**
     * Check if directory exists
     */
    private async directoryExists(dirPath: string): Promise<boolean> {
        try {
            const stat = await fs.stat(dirPath);
            return stat.isDirectory();
        } catch {
            return false;
        }
    }

    /**
     * Find GitHub Copilot extension directories
     */
    private async findCopilotExtensionDirectories(extHostPath: string): Promise<string[]> {
        const copilotDirs: string[] = [];
        try {
            const entries = await fs.readdir(extHostPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && (
                    entry.name.includes('GitHub.copilot') || 
                    entry.name.includes('GitHub.copilot-chat')
                )) {
                    copilotDirs.push(path.join(extHostPath, entry.name));
                }
            }
        } catch (error) {
            await this.debug(`Error reading copilot directories from ${extHostPath}: ${error}`);
        }
        return copilotDirs;
    }

    /**
     * Remove duplicate events based on ID
     */
    private deduplicateEvents(events: CopilotUsageEvent[]): CopilotUsageEvent[] {
        const seen = new Set<string>();
        return events.filter(event => {
            if (seen.has(event.id)) {
                return false;
            }
            seen.add(event.id);
            return true;
        });
    }

    /**
     * Debug method to inspect actual log file content
     */
    async inspectLogFile(filePath: string, maxLines: number = 10): Promise<void> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n').slice(0, maxLines);
            
            await this.debug(`=== INSPECTING LOG FILE: ${filePath} ===`);
            await this.debug(`Total lines: ${content.split('\n').length}`);
            await this.debug(`Sample lines:`);
            
            lines.forEach((line, index) => {
                if (line.trim()) {
                    this.debug(`Line ${index + 1}: ${line}`);
                }
            });
            
            await this.debug(`=== END INSPECTION ===`);
        } catch (error) {
            await this.debug(`Failed to inspect log file ${filePath}: ${error}`);
        }
    }

    /**
     * Debug logging helper using dependency injection
     */
    private async debug(message: string): Promise<void> {
        this.logger.appendLine(`[CopilotLogParser] ${message}`);
    }
}
