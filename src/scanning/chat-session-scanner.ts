/**
 * Chat Session Scanner - Discovers and monitors VS Code chat session files
 * Replaces log parsing with direct session file access
 */

import * as vscode from 'vscode';
import { ForceFileWatcher } from '../util/force-file-watcher';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { 
    CopilotChatSession, 
    SessionScanResult, 
    SessionScanStats, 
    SessionWatcherOptions,
    SESSION_SCAN_CONSTANTS 
} from '../types/chat-session';
import { ILogger } from '../types/logger';

export class ChatSessionScanner {
    private fileWatcher?: ForceFileWatcher;
    private watcherCallbacks: Array<(result: SessionScanResult) => void> = [];
    private isWatching = false;
    
    constructor(
        private readonly logger: ILogger,
        private readonly watcherOptions: SessionWatcherOptions = {
            enableWatching: true,
            debounceMs: SESSION_SCAN_CONSTANTS.DEFAULT_DEBOUNCE_MS,
            maxRetries: SESSION_SCAN_CONSTANTS.DEFAULT_MAX_RETRIES
        }
    ) {}

    /**
     * Find all chat session files across VS Code storage locations
     */
    async findAllChatSessionFiles(): Promise<string[]> {
        this.logger.info('Starting comprehensive session file scan...');
        
        const allFiles: string[] = [];
        const basePaths = this.getVSCodeStoragePaths();
        
        for (const basePath of basePaths) {
            try {
                const files = await this.scanStorageLocation(basePath);
                allFiles.push(...files);
                this.logger.debug(`Found ${files.length} session files in ${basePath}`);
            } catch (error) {
                this.logger.error(`Error scanning ${basePath}: ${error}`);
            }
        }
        
        this.logger.info(`Total session files found: ${allFiles.length}`);
        return allFiles;
    }

    /**
     * Scan a specific VS Code storage location for chat session files
     */
    private async scanStorageLocation(storagePath: string): Promise<string[]> {
        const sessionFiles: string[] = [];
        
        try {
            // Check if storage path exists
            await fs.access(storagePath);
            
            // Read workspace directories
            const workspaceDirs = await fs.readdir(storagePath, { withFileTypes: true });
            
            for (const workspaceDir of workspaceDirs) {
                if (!workspaceDir.isDirectory()) {
                    continue;
                }
                
                const chatSessionsPath = path.join(storagePath, workspaceDir.name, SESSION_SCAN_CONSTANTS.CHAT_SESSIONS_DIR);
                
                try {
                    await fs.access(chatSessionsPath);
                    const sessionFiles_local = await this.scanChatSessionsDirectory(chatSessionsPath);
                    sessionFiles.push(...sessionFiles_local);
                } catch {
                    // chatSessions directory doesn't exist in this workspace
                    continue;
                }
            }
        } catch (error) {
            throw new Error(`Failed to scan storage location ${storagePath}: ${error}`);
        }
        
        return sessionFiles;
    }

    /**
     * Scan a specific chatSessions directory for JSON files
     */
    private async scanChatSessionsDirectory(chatSessionsPath: string): Promise<string[]> {
        const sessionFiles: string[] = [];
        
        try {
            const files = await fs.readdir(chatSessionsPath);
            
            for (const fileName of files) {
                // Check if file matches session pattern
                if (!SESSION_SCAN_CONSTANTS.SESSION_FILE_PATTERN.test(fileName)) {
                    continue;
                }
                
                const filePath = path.join(chatSessionsPath, fileName);
                
                try {
                    const stats = await fs.stat(filePath);
                    
                    // Skip files that are too large
                    if (stats.size > SESSION_SCAN_CONSTANTS.MAX_FILE_SIZE_MB * 1024 * 1024) {
                        this.logger.debug(`Skipping large file: ${filePath} (${Math.round(stats.size / 1024 / 1024)}MB)`);
                        continue;
                    }
                    
                    sessionFiles.push(filePath);
                } catch (error) {
                    this.logger.error(`Error checking file ${filePath}: ${error}`);
                }
            }
        } catch (error) {
            throw new Error(`Failed to read chatSessions directory ${chatSessionsPath}: ${error}`);
        }
        
        return sessionFiles;
    }

    /**
     * Parse a single session file and return structured data
     */
    async parseSessionFile(filePath: string): Promise<SessionScanResult | null> {
        try {
            // Get file stats
            const stats = await fs.stat(filePath);
            
            // Read and parse file content
            const content = await fs.readFile(filePath, 'utf-8');
            const session: CopilotChatSession = JSON.parse(content);
            
            // Validate session structure
            if (!this.isValidSession(session)) {
                this.logger.error(`Invalid session structure in ${filePath}`);
                return null;
            }
            
            const result = {
                sessionFilePath: filePath,
                session,
                lastModified: stats.mtime,
                fileSize: stats.size
            };
            
            // Log the result structure for debugging
            this.logger.debug(`Created SessionScanResult with sessionFilePath: "${result.sessionFilePath}" (type: ${typeof result.sessionFilePath})`);
            
            return result;
        } catch (error) {
            this.logger.error(`Error parsing session file ${filePath}: ${error}`);
            return null;
        }
    }

    /**
     * Scan all session files and return parsed results
     */
    async scanAllSessions(): Promise<{ results: SessionScanResult[]; stats: SessionScanStats }> {
        const startTime = Date.now();
        
        this.logger.info('Starting full session scan...');
        
        const allFiles = await this.findAllChatSessionFiles();
        const results: SessionScanResult[] = [];
        let errorFiles = 0;
        let totalRequests = 0;
        let oldestSession: string | undefined;
        let newestSession: string | undefined;
        
        // Process files in batches to avoid memory issues
        const batchSize = 50;
        for (let i = 0; i < allFiles.length; i += batchSize) {
            const batch = allFiles.slice(i, i + batchSize);
            
            const batchPromises = batch.map(async (filePath) => {
                const result = await this.parseSessionFile(filePath);
                if (result) {
                    totalRequests += result.session.requests.length;
                    
                    // Track oldest/newest sessions (convert to ISO string for comparison)
                    const sessionDate = new Date(result.session.creationDate).toISOString();
                    if (!oldestSession || sessionDate < oldestSession) {
                        oldestSession = sessionDate;
                    }
                    if (!newestSession || sessionDate > newestSession) {
                        newestSession = sessionDate;
                    }
                    
                    return result;
                } else {
                    errorFiles++;
                    return null;
                }
            });
            
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults.filter(r => r !== null) as SessionScanResult[]);
            
            // Progress reporting
            if (allFiles.length > 100 && i % 100 === 0) {
                this.logger.debug(`Processed ${i + batchSize}/${allFiles.length} files...`);
            }
        }
        
        const scanDuration = Date.now() - startTime;
        
        const stats: SessionScanStats = {
            totalSessions: results.length,
            totalRequests,
            scannedFiles: allFiles.length,
            errorFiles,
            scanDuration,
            oldestSession,
            newestSession
        };
        
        this.logger.info(`Scan complete: ${results.length} sessions, ${totalRequests} requests in ${scanDuration}ms`);
        
        return { results, stats };
    }

    /**
     * Start watching for new/modified session files
     */
    startWatching(callback: (result: SessionScanResult) => void): void {
        if (!this.watcherOptions.enableWatching || this.isWatching) {
            return;
        }
        
        this.watcherCallbacks.push(callback);
        
        if (this.watcherCallbacks.length === 1) {
            this.setupFileWatcher();
        }
        
        this.isWatching = true;
        this.logger.info('Started watching for session file changes');
    }

    /**
     * Stop watching for session file changes
     */
    stopWatching(): void {
        if (!this.isWatching) {
            return;
        }
        
        this.watcherCallbacks = [];
        
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
            this.fileWatcher = undefined;
        }
        
        this.isWatching = false;
        this.logger.info('Stopped watching for session file changes');
    }

    /**
     * Setup file system watcher for session directories
     */
    private setupFileWatcher(): void {
        // Create a pattern that matches chatSessions directories
        const pattern = new vscode.RelativePattern(
            vscode.workspace.workspaceFolders?.[0] || vscode.Uri.file(os.homedir()),
            '**/chatSessions/*.json'
        );
        
        this.fileWatcher = new ForceFileWatcher(
            pattern,
            0,    // No forced flush needed for session files
            3000  // Heavy debouncing (3s) - sessions update in bursts, we don't need immediate response
        );
        
        // Debounced handler for file changes
        let debounceTimer: NodeJS.Timeout | undefined;
        
        const handleFileChange = async (uri: vscode.Uri) => {
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }
            
            debounceTimer = setTimeout(async () => {
                try {
                    const result = await this.parseSessionFile(uri.fsPath);
                    if (result) {
                        this.watcherCallbacks.forEach(callback => callback(result));
                    }
                } catch (error) {
                    this.logger.error(`Error handling file change ${uri.fsPath}: ${error}`);
                }
            }, this.watcherOptions.debounceMs);
        };
        
        this.fileWatcher.onDidCreate(handleFileChange);
        this.fileWatcher.onDidChange(handleFileChange);
        
        // Start the watcher
        this.fileWatcher.start();
    }

    /**
     * Get VS Code storage paths for current OS
     */
    private getVSCodeStoragePaths(): string[] {
        const homeDir = os.homedir();
        const paths: string[] = [];
        
        if (process.platform === 'win32') {
            // Windows paths
            for (const relativePath of SESSION_SCAN_CONSTANTS.VSCODE_STORAGE_PATHS) {
                paths.push(path.join(homeDir, relativePath));
            }
        } else if (process.platform === 'darwin') {
            // macOS paths
            paths.push(
                path.join(homeDir, 'Library/Application Support/Code/User/workspaceStorage'),
                path.join(homeDir, 'Library/Application Support/Code - Insiders/User/workspaceStorage')
            );
        } else {
            // Linux paths
            paths.push(
                path.join(homeDir, '.config/Code/User/workspaceStorage'),
                path.join(homeDir, '.config/Code - Insiders/User/workspaceStorage')
            );
        }
        
        return paths;
    }

    /**
     * Validate that a parsed object is a valid session
     */
    private isValidSession(obj: any): obj is CopilotChatSession {
        if (!obj) {
            return false;
        }
        
        // Check required session fields
        if (typeof obj.sessionId !== 'string') {
            this.logger.trace(`Invalid sessionId: ${typeof obj.sessionId}`);
            return false;
        }
        
        if (typeof obj.creationDate !== 'number') {
            this.logger.trace(`Invalid creationDate: ${typeof obj.creationDate}`);
            return false;
        }
        
        if (typeof obj.version !== 'number') {
            this.logger.trace(`Invalid version: ${typeof obj.version}`);
            return false;
        }
        
        if (!Array.isArray(obj.requests)) {
            this.logger.trace(`Invalid requests: ${typeof obj.requests}`);
            return false;
        }
        
        // Check each request structure
        for (let i = 0; i < obj.requests.length; i++) {
            const req = obj.requests[i];
            
            if (!req) {
                this.logger.trace(`Request ${i} is falsy`);
                return false;
            }
            
            if (typeof req.requestId !== 'string') {
                this.logger.trace(`Request ${i} invalid requestId: ${typeof req.requestId}`);
                return false;
            }
            
            if (typeof req.timestamp !== 'number') {
                this.logger.trace(`Request ${i} invalid timestamp: ${typeof req.timestamp}`);
                return false;
            }
            
            // modelId is optional - many requests legitimately don't have it
            if (req.modelId !== undefined && typeof req.modelId !== 'string') {
                this.logger.trace(`Request ${i} invalid modelId: ${typeof req.modelId}`);
                return false;
            }
            
            if (!req.message || typeof req.message.text !== 'string') {
                this.logger.trace(`Request ${i} invalid message: ${!req.message ? 'missing' : typeof req.message.text}`);
                return false;
            }
            
            // agent is optional - slash commands like /clear don't have an agent
            if (req.agent !== undefined) {
                if (typeof req.agent.id !== 'string') {
                    this.logger.trace(`Request ${i} invalid agent.id: ${typeof req.agent.id}`);
                    return false;
                }
            }
        }
        
        return true;
    }

    /**
     * Get scanner statistics
     */
    getWatcherStatus(): { isWatching: boolean; callbackCount: number } {
        return {
            isWatching: this.isWatching,
            callbackCount: this.watcherCallbacks.length
        };
    }

    /**
     * Cleanup resources
     */
    dispose(): void {
        this.stopWatching();
    }
}
