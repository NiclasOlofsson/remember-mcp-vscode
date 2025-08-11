/**
 * Updated CopilotLogScanner using VS Code API to get current session log directory
 * This solves the RelativePattern issue with spaces and ensures we're monitoring the correct session
 */

import * as vscode from 'vscode';
import { ForceFileWatcher } from '../util/force-file-watcher';
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
    timestamp: Date;
    requestId: string;
}

export interface LogRequestEntry {
    timestamp: Date;
    level: string;
    requestId: string;
    modelDeploymentId: string;
    rawLine: string;
}

export interface LogCompletionEntry {
    timestamp: Date;
    level: string;
    requestRef: string;
    modelName: string;
    responseTime: number;
    status: 'success' | 'error';
    context: string; // e.g., "[panel/editAgent]"
    rawLine: string;
}

export interface LogEntry {
    timestamp: Date;
    level: string;
    requestId: string;
    modelName: string;
    responseTime: number;
    status: 'success' | 'error';
    rawLine: string;
    finishReason?: string; // From multi-line parsing
    context?: string; // From multi-line parsing
    ccreqId?: string; // From multi-line parsing
}

export interface LogScanStats {
    totalLines: number;
    parsedPairs: number;
    errorCount: number;
    lastScanTime: Date;
    logFilePath: string | null;
}

export interface LogScannerOptions {
    enableWatching?: boolean;
    debounceMs?: number;
    maxRetries?: number;
    forceFlushIntervalMs?: number; // Periodic check to force detection of delayed writes
    enableForceFlush?: boolean; // Enable periodic file checks to catch delayed writes
}

export class CopilotLogScanner {
    // Updated pattern to match actual VS Code log format with more flexibility:
    // 2025-08-10 15:15:27.396 [info] ccreq:22580442.copilotmd | markdown
    // 2025-08-10 15:15:27.395 [info] Latest entry: ccreq:latestrequest.copilotmd
    private static readonly LOG_PATTERN = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[(\w+)\] (?:Latest entry: )?ccreq:([^|.\s]+)(?:\.copilotmd)?(?:\s*\|\s*(.+))?/;
    
    // Multi-line pattern to capture 3-line request sequences:
    // Line 1: message X returned. finish reason: [reason]
    // Line 2: request done: requestId: [id] model deployment ID: [id]
    // Line 3: ccreq:id | status | model | duration | [context]
    private static readonly MULTILINE_REQUEST_PATTERN = new RegExp(
        // Line 1: message returned with finish reason
        `(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3}) \\[info\\] message \\d+ returned\\. finish reason: \\[([^\\]]+)\\]\\s*` +
        // Line 2: request done with requestId
        `(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3}) \\[info\\] request done: requestId: \\[([^\\]]+)\\] model deployment ID: \\[([^\\]]*)\\]\\s*` +
        // Line 3: ccreq with model info
        `(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3}) \\[info\\] ccreq:([^|.\\s]+)(?:\\.copilotmd)?\\s*\\|\\s*([^|]+)\\s*\\|\\s*([^|]+)\\s*\\|\\s*([^|]+)\\s*\\|\\s*\\[([^\\]]+)\\]`,
        'g'
    );

    /**
     * Parse timestamp from VS Code log format: "2025-08-10 15:15:27.396"
     * Returns a proper Date object
     */
    private static parseTimestamp(timestampStr: string): Date {
        // The format is: YYYY-MM-DD HH:mm:ss.SSS
        // Convert to ISO format by adding 'T' and 'Z': YYYY-MM-DDTHH:mm:ss.SSSZ
        const isoString = timestampStr.replace(' ', 'T') + 'Z';
        return new Date(isoString);
    }
    
    private watcher?: ForceFileWatcher;
    private callbacks: Array<(result: LogScanResult) => void> = [];
    private isWatching = false;
    private options: LogScannerOptions;
    private extensionContext?: vscode.ExtensionContext;
    private lastFilePosition: number = 0;
    private currentLogPath: string | null = null;
    private forceFlushTimer?: NodeJS.Timeout; // Timer for periodic file checks

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
            forceFlushIntervalMs: options.forceFlushIntervalMs ?? 1000, // Check every 1 second by default
            enableForceFlush: options.enableForceFlush ?? true, // Enable by default to catch delayed writes
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
     * Force check for new content by directly accessing the file
     * This bypasses filesystem watcher delays and catches buffered writes
     */
    private async forceFlushCheck(): Promise<void> {
        if (!this.currentLogPath) {
            return;
        }

        try {
            const result = await this.scanLogFile(this.currentLogPath);
            
            if (result.logPairs.length > 0) {
                this.logger.appendLine(`[CopilotLogScanner] FORCE-FLUSH: Found ${result.logPairs.length} delayed entries, notifying callbacks`);
                this.notifyCallbacks(result);
            }
        } catch (error) {
            this.logger.appendLine(`[CopilotLogScanner] FORCE-FLUSH ERROR: ${error}`);
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
                    lastScanTime: new Date(),
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
            const content = await this.readNewContent(actualLogPath);
            
            if (!content.trim()) {
                return {
                    logPairs: [],
                    scanStats: {
                        totalLines: 0,
                        parsedPairs: 0,
                        errorCount: 0,
                        lastScanTime: new Date(),
                        logFilePath: actualLogPath
                    }
                };
            }
            
            const lines = content.split('\n').filter(line => line.trim());
            const logEntries: LogEntry[] = [];
            let errorCount = 0;

            this.logger.appendLine(`[CopilotLogScanner] Processing ${lines.length} new lines`);

            // First, try multi-line parsing for complete 3-line request sequences
            const multiLineMatches = this.parseMultiLineRequests(content);
            this.logger.appendLine(`[CopilotLogScanner] Found ${multiLineMatches.length} complete 3-line request sequences`);
            
            // Log detailed information about each multi-line match
            multiLineMatches.forEach((entry: LogEntry, index: number) => {
                this.logger.appendLine(`[CopilotLogScanner] Multi-line match ${index + 1}:`);
                this.logger.appendLine(`  Timestamp: ${entry.timestamp.toISOString()} (${entry.timestamp.toLocaleString()})`);
                this.logger.appendLine(`  Request ID: ${entry.requestId}`);
                this.logger.appendLine(`  ccreq ID: ${entry.ccreqId || 'N/A'}`);
                this.logger.appendLine(`  Finish Reason: ${entry.finishReason || 'N/A'}`);
                this.logger.appendLine(`  Model: ${entry.modelName}`);
                this.logger.appendLine(`  Duration: ${entry.responseTime}ms`);
                this.logger.appendLine(`  Context: ${entry.context || 'N/A'}`);
                this.logger.appendLine(`  Status: ${entry.status}`);
                logEntries.push(entry);
            });

            // Fallback to single-line parsing for any remaining relevant lines
            for (const line of lines) {
                if (this.isRelevantLine(line)) {
                    const entry = this.parseLogLine(line);
                    if (entry) {
                        // Check if this entry was already captured by multi-line parsing
                        const alreadyCaptured = multiLineMatches.some((mlEntry: LogEntry) => 
                            mlEntry.requestId === entry.requestId || 
                            (mlEntry.timestamp === entry.timestamp && mlEntry.modelName === entry.modelName)
                        );
                        
                        if (!alreadyCaptured) {
                            this.logger.appendLine(`[CopilotLogScanner] Single-line fallback entry: ${entry.requestId} at ${entry.timestamp.toISOString()}`);
                            logEntries.push(entry);
                        }
                    } else {
                        errorCount++;
                    }
                }
            }

            const scanStats: LogScanStats = {
                totalLines: lines.length,
                parsedPairs: logEntries.length,
                errorCount,
                lastScanTime: new Date(),
                logFilePath: actualLogPath
            };

            this.logger.appendLine(`[CopilotLogScanner] Found ${logEntries.length} new entries (${multiLineMatches.length} multi-line, ${logEntries.length - multiLineMatches.length} single-line)`);
            
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
                    context: entry.context || '', // Use context from multi-line parsing
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
     * Parse multi-line request sequences from log content
     * Captures 3-line patterns: finish reason, request done, ccreq info
     */
    private parseMultiLineRequests(content: string): LogEntry[] {
        const entries: LogEntry[] = [];
        
        let match;
        while ((match = CopilotLogScanner.MULTILINE_REQUEST_PATTERN.exec(content)) !== null) {
            const [
                fullMatch,
                timestamp1, finishReason,
                timestamp2, requestId, modelDeploymentId,
                timestamp3, ccreqId, status, modelName, duration, context
            ] = match;
            
            try {
                // Use the latest timestamp (from ccreq line)
                const parsedTimestamp = CopilotLogScanner.parseTimestamp(timestamp3);
                
                // Extract response time from duration string (e.g., "12862ms")
                const timingMatch = duration.match(/(\d+)ms/);
                const responseTime = timingMatch ? parseInt(timingMatch[1], 10) : 0;
                
                const entry: LogEntry = {
                    timestamp: parsedTimestamp,
                    level: 'info',
                    requestId: requestId.trim(),
                    modelName: modelName.trim(),
                    responseTime,
                    status: status.trim() === 'error' ? 'error' : 'success',
                    rawLine: fullMatch, // Store the complete 3-line match
                    finishReason: finishReason.trim(),
                    context: context.trim(),
                    ccreqId: ccreqId.trim()
                };
                
                entries.push(entry);
            } catch (error) {
                this.logger.appendLine(`[CopilotLogScanner] Error parsing multi-line match: ${error}`);
            }
        }
        
        return entries;
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
            const parsedTimestamp = CopilotLogScanner.parseTimestamp(timestamp);
            
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
     * Also starts periodic force-flush checking to catch delayed writes
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

        // Start periodic force-flush checking to catch delayed writes
        if (this.options.enableForceFlush && this.options.forceFlushIntervalMs) {
            this.forceFlushTimer = setInterval(() => {
                this.forceFlushCheck();
            }, this.options.forceFlushIntervalMs);
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
        this.watcher = new ForceFileWatcher(
            new vscode.RelativePattern(path.dirname(logPath), path.basename(logPath)),
            this.options.forceFlushIntervalMs,
            async (uri: vscode.Uri) => {
                // Forced check: return file mtime
                try {
                    const stat = await fs.stat(uri.fsPath);
                    return stat.mtimeMs;
                } catch {
                    return null;
                }
            }
        );

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
            this.switchToDirectoryWatching();
        });
        
        // Start the watcher
        this.watcher.start();

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
            this.watcher = new ForceFileWatcher(
                watchPattern,
                this.options.forceFlushIntervalMs,
                async (uri: vscode.Uri) => {
                    try {
                        const stat = await fs.stat(uri.fsPath);
                        return stat.mtimeMs;
                    } catch {
                        return null;
                    }
                }
            );

        this.watcher.onDidCreate(async (uri) => {
            const createdFile = uri.fsPath;
            this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: New file created in Copilot directory - ${createdFile}`);
            if (createdFile.endsWith('.log')) {
                this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: Copilot log file created! Switching to file watcher - ${createdFile}`);
                this.watcher?.dispose();
                await this.setupFileWatcher(createdFile);
            }
        });
        this.watcher.onDidChange(async (uri) => {
            const changedFile = uri.fsPath;
            if (changedFile.endsWith('.log')) {
                this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: Copilot log file changed - ${changedFile}`);
                try {
                    const result = await this.scanLogFile(changedFile);
                    this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: Directory scan complete - ${result.logPairs.length} pairs found`);
                    this.notifyCallbacks(result);
                } catch (error) {
                    this.logger.appendLine(`[CopilotLogScanner] REAL-TIME ERROR during directory watch scan: ${error}`);
                }
            }
        });
        
        // Start the watcher
        this.watcher.start();            this.isWatching = true;
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
        
        if (this.forceFlushTimer) {
            clearInterval(this.forceFlushTimer);
            this.forceFlushTimer = undefined;
            this.logger.appendLine('[CopilotLogScanner] Stopped force-flush timer');
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
     * Manually trigger a force flush check to catch any delayed writes
     * Useful when you suspect writes have been buffered
     */
    async manualForceFlush(): Promise<LogScanResult | null> {
        if (!this.currentLogPath) {
            this.logger.appendLine('[CopilotLogScanner] Manual force flush requested but no log path available');
            return null;
        }

        this.logger.appendLine('[CopilotLogScanner] Manual force flush triggered');
        try {
            const result = await this.scanLogFile(this.currentLogPath);
            if (result.logPairs.length > 0) {
                this.logger.appendLine(`[CopilotLogScanner] Manual force flush found ${result.logPairs.length} entries`);
                this.notifyCallbacks(result);
            } else {
                this.logger.appendLine('[CopilotLogScanner] Manual force flush found no new entries');
            }
            return result;
        } catch (error) {
            this.logger.appendLine(`[CopilotLogScanner] Manual force flush error: ${error}`);
            return null;
        }
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
