/**
 * Updated CopilotLogScanner using VS Code API to get current session log directory
 * This solves the RelativePattern issue with spaces and ensures we're monitoring the correct session
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ILogger } from '../types/logger';

export interface LogScanResult {
    logPairs: LogEntryPair[];
    scanStats: LogScanStats;
}

export interface LogEntryPair {
    requestEntry: LogRequestEntry;
    completionEntry: LogCompletionEntry;
    timestamp: string;
    requestId: string;
}

export interface LogRequestEntry {
    timestamp: string;
    level: string;
    requestId: string;
    modelDeploymentId: string;
    rawLine: string;
}

export interface LogCompletionEntry {
    timestamp: string;
    level: string;
    requestRef: string;
    modelName: string;
    responseTime: number;
    status: 'success' | 'error';
    context: string; // e.g., "[panel/editAgent]"
    rawLine: string;
}

export interface LogEntry {
    timestamp: string;
    level: string;
    requestId: string;
    modelName: string;
    responseTime: number;
    status: 'success' | 'error';
    rawLine: string;
}

export interface LogScanStats {
    totalLines: number;
    parsedPairs: number;
    errorCount: number;
    lastScanTime: string;
    logFilePath: string | null;
}

export interface LogScannerOptions {
    enableWatching?: boolean;
    debounceMs?: number;
    maxRetries?: number;
}

export class CopilotLogScanner {
    // Updated pattern to match actual VS Code log format with more flexibility:
    // 2025-08-10 15:15:27.396 [info] ccreq:22580442.copilotmd | markdown
    // 2025-08-10 15:15:27.395 [info] Latest entry: ccreq:latestrequest.copilotmd
    private static readonly LOG_PATTERN = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[(\w+)\] (?:Latest entry: )?ccreq:([^|.\s]+)(?:\.copilotmd)?(?:\s*\|\s*(.+))?/;
    
    private watcher?: vscode.FileSystemWatcher;
    private callbacks: Array<(result: LogScanResult) => void> = [];
    private isWatching = false;
    private options: LogScannerOptions;
    private extensionContext?: vscode.ExtensionContext;
    private lastFilePosition: number = 0;
    private currentLogPath: string | null = null;

    constructor(
        private readonly logger: ILogger,
        extensionContext?: vscode.ExtensionContext,
        options: LogScannerOptions = {}
    ) {
        this.extensionContext = extensionContext;
        this.options = {
            enableWatching: options.enableWatching ?? false,
            debounceMs: options.debounceMs ?? 500,
            maxRetries: options.maxRetries ?? 3,
            ...options
        };
    }

    /**
     * Find the Copilot Chat log file path using VS Code's session log directory
     */
    async findLogPath(): Promise<string | null> {
        try {
            if (!this.extensionContext) {
                this.logger.appendLine('[CopilotLogScanner] No extension context provided - cannot access session logs');
                return null;
            }

            // Use VS Code's logUri to get the current session's log directory
            const sessionLogUri = this.extensionContext.logUri;
            const sessionLogDir = sessionLogUri.fsPath;
            
            this.logger.appendLine(`[CopilotLogScanner] Current session log directory (extension): ${sessionLogDir}`);

            // Navigate to parent exthost directory, then find GitHub.copilot-chat
            const exthostDir = path.dirname(sessionLogDir);
            const copilotLogDir = path.join(exthostDir, 'GitHub.copilot-chat');
            
            this.logger.appendLine(`[CopilotLogScanner] Looking for Copilot log directory: ${copilotLogDir}`);
            
            try {
                const stat = await fs.stat(copilotLogDir);
                if (!stat.isDirectory()) {
                    this.logger.appendLine('[CopilotLogScanner] Copilot log path exists but is not a directory');
                    return null;
                }
            } catch (error) {
                this.logger.appendLine(`[CopilotLogScanner] Copilot log directory does not exist: ${copilotLogDir}`);
                return null;
            }

            // Find the .log file
            const files = await fs.readdir(copilotLogDir);
            const logFile = files.find(f => f.endsWith('.log'));
            
            if (logFile) {
                const logPath = path.join(copilotLogDir, logFile);
                this.logger.appendLine(`[CopilotLogScanner] Found Copilot log file: ${logPath}`);
                return logPath;
            } else {
                this.logger.appendLine('[CopilotLogScanner] No .log file found in Copilot directory');
                this.logger.appendLine(`[CopilotLogScanner] Available files: ${files.join(', ')}`);
                return null;
            }
        } catch (error) {
            this.logger.appendLine(`[CopilotLogScanner] Error finding log path: ${error}`);
            return null;
        }
    }

    /**
     * Read only new content from the log file since last read position
     */
    private async readNewContent(logPath: string): Promise<string> {
        try {
            const stats = await fs.stat(logPath);
            
            // If file was truncated or is smaller than last position, reset
            if (stats.size < this.lastFilePosition) {
                this.logger.appendLine(`[CopilotLogScanner] File truncated or rotated, resetting position`);
                this.lastFilePosition = 0;
            }
            
            // If no new content, return empty
            if (stats.size <= this.lastFilePosition) {
                return '';
            }
            
            // Read only the new content
            const fd = await fs.open(logPath, 'r');
            const newContentSize = stats.size - this.lastFilePosition;
            const buffer = Buffer.alloc(newContentSize);
            
            await fd.read(buffer, 0, newContentSize, this.lastFilePosition);
            await fd.close();
            
            // Update position for next read
            this.lastFilePosition = stats.size;
            
            const newContent = buffer.toString('utf-8');
            this.logger.appendLine(`[CopilotLogScanner] Read ${newContentSize} bytes of new content from position ${this.lastFilePosition - newContentSize}`);
            
            return newContent;
        } catch (error) {
            this.logger.appendLine(`[CopilotLogScanner] Error reading new content: ${error}`);
            return '';
        }
    }

    /**
     * Initialize file position to current end of file for incremental scanning
     */
    private async initializeFilePosition(logPath: string): Promise<void> {
        try {
            const stats = await fs.stat(logPath);
            this.lastFilePosition = stats.size;
            this.currentLogPath = logPath;
            this.logger.appendLine(`[CopilotLogScanner] Initialized file position to ${this.lastFilePosition} for: ${logPath}`);
        } catch (error) {
            this.logger.appendLine(`[CopilotLogScanner] Error initializing file position: ${error}`);
            this.lastFilePosition = 0;
        }
    }

    /**
     * Process log entries using incremental scanning
     * Only reads new content since last scan position
     */
    async scanLogFile(logPath?: string): Promise<LogScanResult> {
        const actualLogPath = logPath || await this.findLogPath();
        
        if (!actualLogPath) {
            return {
                logPairs: [],
                scanStats: {
                    totalLines: 0,
                    parsedPairs: 0,
                    errorCount: 1,
                    lastScanTime: new Date().toISOString(),
                    logFilePath: null
                }
            };
        }

        // Initialize file position if this is a new log path
        if (this.currentLogPath !== actualLogPath) {
            await this.initializeFilePosition(actualLogPath);
        }

        try {
            // Always use incremental scanning - read only new content
            this.logger.appendLine(`[CopilotLogScanner] Incremental scan - reading new content: ${actualLogPath}`);
            const content = await this.readNewContent(actualLogPath);
            
            if (!content.trim()) {
                this.logger.appendLine(`[CopilotLogScanner] No new content found`);
                return {
                    logPairs: [],
                    scanStats: {
                        totalLines: 0,
                        parsedPairs: 0,
                        errorCount: 0,
                        lastScanTime: new Date().toISOString(),
                        logFilePath: actualLogPath
                    }
                };
            }
            
            const lines = content.split('\n').filter(line => line.trim());
            const logEntries: LogEntry[] = [];
            let errorCount = 0;

            this.logger.appendLine(`[CopilotLogScanner] Processing ${lines.length} new lines`);

            for (const line of lines) {
                if (this.isRelevantLine(line)) {
                    const entry = this.parseLogLine(line);
                    if (entry) {
                        logEntries.push(entry);
                    } else {
                        errorCount++;
                    }
                }
            }

            const scanStats: LogScanStats = {
                totalLines: lines.length,
                parsedPairs: logEntries.length,
                errorCount,
                lastScanTime: new Date().toISOString(),
                logFilePath: actualLogPath
            };

            this.logger.appendLine(`[CopilotLogScanner] Found ${logEntries.length} new entries`);
            
            // Convert individual entries to pairs for compatibility
            const logPairs: LogEntryPair[] = logEntries.map(entry => ({
                requestEntry: {
                    timestamp: entry.timestamp,
                    level: entry.level,
                    requestId: entry.requestId,
                    modelDeploymentId: entry.modelName,
                    rawLine: entry.rawLine
                },
                completionEntry: {
                    timestamp: entry.timestamp,
                    level: entry.level,
                    requestRef: entry.requestId,
                    modelName: entry.modelName,
                    responseTime: entry.responseTime,
                    status: entry.status,
                    context: '', // Not available from current parsing
                    rawLine: entry.rawLine
                },
                timestamp: entry.timestamp,
                requestId: entry.requestId
            }));
            
            return { logPairs, scanStats };
        } catch (error) {
            this.logger.appendLine(`[CopilotLogScanner] Error reading log file: ${error}`);
            throw error;
        }
    }

    /**
     * Parse a single log line into a LogEntry
     * Only parses request completion lines, skips metadata requests
     */
    private parseLogLine(line: string): LogEntry | null {
        const match = line.match(CopilotLogScanner.LOG_PATTERN);
        if (!match) {
            return null;
        }

        const [, timestamp, level, requestId, extraInfo] = match;
        
        // Skip metadata requests - only parse lines with completion info
        if (!extraInfo || !extraInfo.includes('|') || extraInfo.split('|').length < 3) {
            return null;
        }
        
        try {
            const parsedTimestamp = new Date(timestamp).toISOString();
            
            // Parse completion info: "success | model-name | 1500ms | [context]"
            const parts = extraInfo.split('|').map(p => p.trim());
            const status: 'success' | 'error' = parts[0] === 'error' ? 'error' : 'success';
            const modelName = parts[1] || 'unknown';
            
            // Extract response time from timing info (e.g., "1500ms")
            const timingMatch = parts[2]?.match(/(\d+)ms/);
            const responseTime = timingMatch ? parseInt(timingMatch[1], 10) : 0;
            
            return {
                timestamp: parsedTimestamp,
                level: level.toLowerCase(),
                requestId: requestId.trim(),
                modelName,
                responseTime,
                status,
                rawLine: line
            };
        } catch (error) {
            this.logger.appendLine(`[CopilotLogScanner] Error parsing line: ${error}`);
            return null;
        }
    }

    /**
     * Check if a line contains a Copilot request completion (not metadata)
     */
    private isRelevantLine(line: string): boolean {
        if (!line.includes('ccreq:')) {
            return false;
        }
        
        const match = line.match(CopilotLogScanner.LOG_PATTERN);
        if (!match) {
            return false;
        }
        
        const [, , , , extraInfo] = match;
        // Only process lines with completion info (multiple pipes), skip metadata requests
        return Boolean(extraInfo && extraInfo.includes('|') && extraInfo.split('|').length >= 3);
    }

    /**
     * Start watching the log file for changes
     * Uses directory watching to detect log file creation if it doesn't exist yet
     * Initializes file position to current end of file to avoid reading old content
     */
    async startWatching(): Promise<void> {
        if (this.isWatching) {
            this.logger.appendLine('[CopilotLogScanner] Already watching, skipping');
            return;
        }

        if (!this.options.enableWatching) {
            this.logger.appendLine('[CopilotLogScanner] Watching is disabled by options');
            return;
        }

        // First, try to find the log file
        const logPath = await this.findLogPath();
        
        if (logPath) {
            // Log file exists - set up file-specific watching
            await this.setupFileWatcher(logPath);
        } else {
            // Log file doesn't exist yet - set up directory watching to detect creation
            await this.setupDirectoryWatcher();
        }
    }

    /**
     * Set up file watcher for an existing log file
     */
    private async setupFileWatcher(logPath: string): Promise<void> {
        // Initialize file position to current end of file to avoid reading old content
        await this.initializeFilePosition(logPath);

        this.logger.appendLine(`[CopilotLogScanner] Setting up file watcher for existing log: ${logPath}`);
        
        // Use simple glob pattern to avoid RelativePattern issues with spaces
        this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path.dirname(logPath), path.basename(logPath)));

        let debounceTimer: NodeJS.Timeout | undefined;

        this.watcher.onDidChange(() => {
            this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: Log file changed detected - ${logPath}`);
            this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: Current callbacks count: ${this.callbacks.length}`);
            
            if (debounceTimer) {
                this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: Clearing previous debounce timer`);
                clearTimeout(debounceTimer);
            }
            
            debounceTimer = setTimeout(async () => {
                try {
                    this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: Starting debounced scan after ${this.options.debounceMs}ms delay`);
                    const result = await this.scanLogFile(logPath);
                    this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: Scan complete - ${result.logPairs.length} pairs found`);
                    this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: About to notify ${this.callbacks.length} callbacks`);
                    this.notifyCallbacks(result);
                    this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: Callback notification complete`);
                } catch (error) {
                    this.logger.appendLine(`[CopilotLogScanner] REAL-TIME ERROR during watch scan: ${error}`);
                }
            }, this.options.debounceMs);
        });

        this.watcher.onDidCreate(() => {
            this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: Log file created - ${logPath}`);
        });

        this.watcher.onDidDelete(() => {
            this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: Log file deleted - ${logPath}`);
            // If the file is deleted, switch to directory watching to detect recreation
            this.switchToDirectoryWatching();
        });

        this.isWatching = true;
        this.logger.appendLine(`[CopilotLogScanner] Successfully started watching log file: ${logPath}`);
        this.logger.appendLine(`[CopilotLogScanner] File watcher configured with debounce: ${this.options.debounceMs}ms`);
    }

    /**
     * Set up directory watcher to detect log file creation
     */
    private async setupDirectoryWatcher(): Promise<void> {
        if (!this.extensionContext) {
            this.logger.appendLine('[CopilotLogScanner] Cannot set up directory watcher - no extension context');
            return;
        }

        try {
            // Watch the parent exthost directory for GitHub.copilot-chat creation
            const sessionLogUri = this.extensionContext.logUri;
            const sessionLogDir = sessionLogUri.fsPath;
            const exthostDir = path.dirname(sessionLogDir);
            const copilotLogDir = path.join(exthostDir, 'GitHub.copilot-chat');

            this.logger.appendLine(`[CopilotLogScanner] Log file not found, setting up directory watcher for: ${copilotLogDir}`);
            
            // Watch for any files created in the copilot log directory
            const watchPattern = path.join(copilotLogDir, '*.log');
            this.watcher = vscode.workspace.createFileSystemWatcher(watchPattern);

            this.watcher.onDidCreate(async (uri) => {
                const createdFile = uri.fsPath;
                this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: New file created in Copilot directory - ${createdFile}`);
                
                if (createdFile.endsWith('.log')) {
                    this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: Copilot log file created! Switching to file watcher - ${createdFile}`);
                    
                    // Stop current directory watcher
                    this.watcher?.dispose();
                    
                    // Set up file-specific watcher for the new log file
                    await this.setupFileWatcher(createdFile);
                }
            });

            this.watcher.onDidChange(async (uri) => {
                const changedFile = uri.fsPath;
                if (changedFile.endsWith('.log')) {
                    this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: Copilot log file changed - ${changedFile}`);
                    
                    // Process the change using the same logic as file watcher
                    try {
                        const result = await this.scanLogFile(changedFile);
                        this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: Directory scan complete - ${result.logPairs.length} pairs found`);
                        this.notifyCallbacks(result);
                    } catch (error) {
                        this.logger.appendLine(`[CopilotLogScanner] REAL-TIME ERROR during directory watch scan: ${error}`);
                    }
                }
            });

            this.isWatching = true;
            this.logger.appendLine(`[CopilotLogScanner] Successfully started directory watching for log file creation`);
            this.logger.appendLine(`[CopilotLogScanner] Watch pattern: ${watchPattern}`);
            
        } catch (error) {
            this.logger.appendLine(`[CopilotLogScanner] Error setting up directory watcher: ${error}`);
        }
    }

    /**
     * Switch from file watching to directory watching (e.g., when file is deleted)
     */
    private async switchToDirectoryWatching(): Promise<void> {
        this.logger.appendLine(`[CopilotLogScanner] Switching from file watcher to directory watcher`);
        
        if (this.watcher) {
            this.watcher.dispose();
            this.watcher = undefined;
        }
        
        this.isWatching = false;
        this.lastFilePosition = 0;
        this.currentLogPath = null;
        
        // Set up directory watching
        await this.setupDirectoryWatcher();
    }

    /**
     * Stop watching the log file
     */
    stopWatching(): void {
        if (this.watcher) {
            this.watcher.dispose();
            this.watcher = undefined;
        }
        this.isWatching = false;
        this.logger.appendLine('[CopilotLogScanner] Stopped watching log file');
    }

    /**
     * Subscribe to log scan updates
     */
    onLogUpdated(callback: (result: LogScanResult) => void): vscode.Disposable {
        this.callbacks.push(callback);
        this.logger.appendLine(`[CopilotLogScanner] Callback added - now have ${this.callbacks.length} callbacks`);
        
        return {
            dispose: () => {
                const index = this.callbacks.indexOf(callback);
                if (index >= 0) {
                    this.callbacks.splice(index, 1);
                    this.logger.appendLine(`[CopilotLogScanner] Callback removed - now have ${this.callbacks.length} callbacks`);
                }
            }
        };
    }

    /**
     * Notify all callbacks with scan results
     */
    private notifyCallbacks(result: LogScanResult): void {
        this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: Notifying ${this.callbacks.length} callbacks with ${result.logPairs.length} pairs`);
        
        for (let i = 0; i < this.callbacks.length; i++) {
            const callback = this.callbacks[i];
            try {
                this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: Calling callback ${i + 1}/${this.callbacks.length}`);
                callback(result);
            } catch (error) {
                this.logger.appendLine(`[CopilotLogScanner] Callback ${i + 1} error: ${error}`);
            }
        }
        
        this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: All callbacks completed`);
    }

    /**
     * Get watching status
     */
    getWatcherStatus(): { isWatching: boolean; callbackCount: number; filePosition: number; logPath: string | null } {
        return {
            isWatching: this.isWatching,
            callbackCount: this.callbacks.length,
            filePosition: this.lastFilePosition,
            logPath: this.currentLogPath
        };
    }

    /**
     * Reset file position for fresh scanning
     */
    resetFilePosition(): void {
        this.lastFilePosition = 0;
        this.logger.appendLine('[CopilotLogScanner] File position reset to beginning');
    }

    /**
     * Cleanup resources
     */
    dispose(): void {
        this.stopWatching();
        this.callbacks = [];
        this.lastFilePosition = 0;
        this.currentLogPath = null;
    }
}
