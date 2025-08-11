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
    logEntries: LogEntry[];
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



export class CopilotLogScanner {
    // Multi-line pattern to capture 3-line request sequences:
    // Line 1: message X returned. finish reason: [reason]
    // Line 2: request done: requestId: [id] model deployment ID: [id]
    // Line 3: ccreq:id | status | model | duration | [context]
    // Uses flexible datetime matching instead of rigid format
    private static readonly MULTILINE_REQUEST_PATTERN = new RegExp(
        // Line 1: message returned with finish reason
        `([^\\[]+)\\s*\\[info\\] message \\d+ returned\\. finish reason: \\[([^\\]]+)\\]\\s*` +
        // Line 2: request done with requestId
        `([^\\[]+)\\s*\\[info\\] request done: requestId: \\[([^\\]]+)\\] model deployment ID: \\[([^\\]]*)\\]\\s*` +
        // Line 3: ccreq with model info
        `([^\\[]+)\\s*\\[info\\] ccreq:([^|.\\s]+)(?:\\.copilotmd)?\\s*\\|\\s*([^|]+)\\s*\\|\\s*([^|]+)\\s*\\|\\s*([^|]+)\\s*\\|\\s*\\[([^\\]]+)\\]`,
        'g'
    );

    /**
     * Parse timestamp from VS Code log format
     * Currently handles: "2025-08-10 15:15:27.396" format  
     * Returns a proper Date object. Can be extended for other datetime formats as needed.
     */
    private static parseTimestamp(timestampStr: string): Date {
        // Trim any whitespace from the captured datetime string
        const cleanTimestamp = timestampStr.trim();
        
        // The current format is: YYYY-MM-DD HH:mm:ss.SSS
        // Convert to ISO format by adding 'T' and 'Z': YYYY-MM-DDTHH:mm:ss.SSSZ
        const isoString = cleanTimestamp.replace(' ', 'T') + 'Z';
        return new Date(isoString);
    }
    
    private watcher?: ForceFileWatcher;
    private isWatching = false;
    private extensionContext?: vscode.ExtensionContext;
    private lastFilePosition: number = 0;
    private currentLogPath: string | null = null;

    constructor(
        private readonly logger: ILogger,
        extensionContext?: vscode.ExtensionContext
    ) {
        this.extensionContext = extensionContext;
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
     * Force OS to flush any buffered writes by accessing the file
     * This should trigger filesystem watcher events if there were delayed writes
     */
    private async forceFlushCheck(): Promise<void> {
        if (!this.currentLogPath) {
            return;
        }

        try {
            // Just poke the file to force OS flush - don't process content
            await fs.stat(this.currentLogPath);
            this.logger.appendLine(`[CopilotLogScanner] FORCE-FLUSH: File poked to trigger OS flush`);
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
                logEntries: []
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
                    logEntries: []
                };
            }
            
            const lines = content.split('\n').filter(line => line.trim());

            this.logger.appendLine(`[CopilotLogScanner] Processing ${lines.length} new lines`);

            // Use multi-line parsing for complete 3-line request sequences
            const logEntries = this.parseMultiLineRequests(content);
            this.logger.appendLine(`[CopilotLogScanner] Found ${logEntries.length} complete 3-line request sequences`);
            
            // Log detailed information about each multi-line match
            logEntries.forEach((entry: LogEntry, index: number) => {
                this.logger.appendLine(`[CopilotLogScanner] Multi-line match ${index + 1}:`);
                this.logger.appendLine(`  Timestamp: ${entry.timestamp.toISOString()} (${entry.timestamp.toLocaleString()})`);
                this.logger.appendLine(`  Request ID: ${entry.requestId}`);
                this.logger.appendLine(`  ccreq ID: ${entry.ccreqId || 'N/A'}`);
                this.logger.appendLine(`  Finish Reason: ${entry.finishReason || 'N/A'}`);
                this.logger.appendLine(`  Model: ${entry.modelName}`);
                this.logger.appendLine(`  Duration: ${entry.responseTime}ms`);
                this.logger.appendLine(`  Context: ${entry.context || 'N/A'}`);
                this.logger.appendLine(`  Status: ${entry.status}`);
            });

            this.logger.appendLine(`[CopilotLogScanner] Found ${logEntries.length} entries using multi-line parsing`);
            return { logEntries };
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

        // Always enable watching
        const logPath = await this.findLogPath();
        if (logPath) {
            await this.setupFileWatcher(logPath);
        } else {
            await this.setupDirectoryWatcher();
        }
    }

    /**
     * Set up file watcher for an existing log file
     */
    private async setupFileWatcher(logPath: string): Promise<void> {
        await this.initializeFilePosition(logPath);
        this.logger.appendLine(`[CopilotLogScanner] Setting up file watcher for existing log: ${logPath}`);
        this.watcher = new ForceFileWatcher(
            new vscode.RelativePattern(path.dirname(logPath), path.basename(logPath)),
            1000, // Force flush every 1s to catch delayed log writes
            300   // Light debouncing (300ms) to prevent rapid-fire events
        );
        this.watcher.onDidChange(async () => {
            this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: Log file changed detected - ${logPath}`);
            try {
                const result = await this.scanLogFile(logPath);
                this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: Scan complete - ${result.logEntries.length} entries found`);
            } catch (error) {
                this.logger.appendLine(`[CopilotLogScanner] REAL-TIME ERROR during watch scan: ${error}`);
            }
        });
        this.watcher.onDidCreate(() => {
            this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: Log file created - ${logPath}`);
        });
        this.watcher.onDidDelete(() => {
            this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: Log file deleted - ${logPath}`);
            this.switchToDirectoryWatching();
        });
        this.watcher.start();
        this.isWatching = true;
        this.logger.appendLine(`[CopilotLogScanner] Successfully started watching log file: ${logPath}`);
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
            const sessionLogUri = this.extensionContext.logUri;
            const sessionLogDir = sessionLogUri.fsPath;
            const exthostDir = path.dirname(sessionLogDir);
            const copilotLogDir = path.join(exthostDir, 'GitHub.copilot-chat');
            this.logger.appendLine(`[CopilotLogScanner] Log file not found, setting up directory watcher for: ${copilotLogDir}`);
            this.watcher = new ForceFileWatcher(
                new vscode.RelativePattern(copilotLogDir, '*.log'),
                1000, // Force flush every 1s to catch delayed log writes
                300   // Light debouncing (300ms) to prevent rapid-fire events
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
                        this.logger.appendLine(`[CopilotLogScanner] REAL-TIME: Directory scan complete - ${result.logEntries.length} entries found`);
                    } catch (error) {
                        this.logger.appendLine(`[CopilotLogScanner] REAL-TIME ERROR during directory watch scan: ${error}`);
                    }
                }
            });
            this.watcher.start();
            this.isWatching = true;
            this.logger.appendLine(`[CopilotLogScanner] Successfully started directory watching for log file creation`);
            this.logger.appendLine(`[CopilotLogScanner] Watch pattern: ${copilotLogDir}`);
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

    // Removed callback registration and notification logic

    /**
     * Get watching status
     */
    getWatcherStatus(): { isWatching: boolean; filePosition: number; logPath: string | null } {
        return {
            isWatching: this.isWatching,
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
            if (result.logEntries.length > 0) {
                this.logger.appendLine(`[CopilotLogScanner] Manual force flush found ${result.logEntries.length} entries`);
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
    this.lastFilePosition = 0;
    this.currentLogPath = null;
    }
}
