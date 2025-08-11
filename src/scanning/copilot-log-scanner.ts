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
		'([^\\[]+)\\s*\\[info\\] message \\d+ returned\\. finish reason: \\[([^\\]]+)\\]\\s*' +
		// Line 2: request done with requestId
		'([^\\[]+)\\s*\\[info\\] request done: requestId: \\[([^\\]]+)\\] model deployment ID: \\[([^\\]]*)\\]\\s*' +
		// Line 3: ccreq with model info
		'([^\\[]+)\\s*\\[info\\] ccreq:([^|.\\s]+)(?:\\.copilotmd)?\\s*\\|\\s*([^|]+)\\s*\\|\\s*([^|]+)\\s*\\|\\s*([^|]+)\\s*\\|\\s*\\[([^\\]]+)\\]',
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
	private logUpdateCallbacks: Array<(logResult: LogScanResult) => void> = [];

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
				this.logger.debug('No extension context provided - cannot access session logs');
				return null;
			}

			// Use VS Code's logUri to get the current session's log directory
			const sessionLogUri = this.extensionContext.logUri;
			const sessionLogDir = sessionLogUri.fsPath;

			this.logger.trace(`Current session log directory (extension): ${sessionLogDir}`);

			// Navigate to parent exthost directory, then find GitHub.copilot-chat
			const exthostDir = path.dirname(sessionLogDir);
			const copilotLogDir = path.join(exthostDir, 'GitHub.copilot-chat');

			this.logger.trace(`Looking for Copilot log directory: ${copilotLogDir}`);

			try {
				const stat = await fs.stat(copilotLogDir);
				if (!stat.isDirectory()) {
					this.logger.trace('Copilot log path exists but is not a directory');
					return null;
				}
			} catch (error) {
				this.logger.warn(`Copilot log directory does not exist: ${copilotLogDir}`, error);
				return null;
			}

			// Find the .log file
			const files = await fs.readdir(copilotLogDir);
			const logFile = files.find(f => f.endsWith('.log'));

			if (logFile) {
				const logPath = path.join(copilotLogDir, logFile);
				this.logger.debug(`Found Copilot log file: ${logPath}`);
				return logPath;
			} else {
				this.logger.trace('No .log file found in Copilot directory');
				this.logger.trace(`Available files: ${files.join(', ')}`);
				return null;
			}
		} catch (error) {
			this.logger.error(`Error finding log path: ${error}`);
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
				this.logger.trace('File truncated or rotated, resetting position');
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
			this.logger.trace(`Read ${newContentSize} bytes of new content from position ${this.lastFilePosition - newContentSize}`);

			return newContent;
		} catch (error) {
			this.logger.error(`Error reading new content: ${error}`);
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
			this.logger.trace('FORCE-FLUSH: File poked to trigger OS flush');
		} catch (error) {
			this.logger.error(`FORCE-FLUSH ERROR: ${error}`);
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
			this.logger.trace(`Initialized file position to ${this.lastFilePosition} for: ${logPath}`);
		} catch (error) {
			this.logger.error(`Error initializing file position: ${error}`);
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

			this.logger.trace(`Processing ${lines.length} new lines`);

			// Use multi-line parsing for complete 3-line request sequences
			const logEntries = this.parseMultiLineRequests(content);
			this.logger.trace(`Found ${logEntries.length} complete 3-line request sequences`);

			// Log detailed information about each multi-line match
			logEntries.forEach((entry: LogEntry, index: number) => {
				this.logger.trace(`Multi-line match ${index + 1}:`);
				this.logger.trace(`  Timestamp: ${entry.timestamp.toISOString()} (${entry.timestamp.toLocaleString()})`);
				this.logger.trace(`  Request ID: ${entry.requestId}`);
				this.logger.trace(`  ccreq ID: ${entry.ccreqId || 'N/A'}`);
				this.logger.trace(`  Finish Reason: ${entry.finishReason || 'N/A'}`);
				this.logger.trace(`  Model: ${entry.modelName}`);
				this.logger.trace(`  Duration: ${entry.responseTime}ms`);
				this.logger.trace(`  Context: ${entry.context || 'N/A'}`);
				this.logger.trace(`  Status: ${entry.status}`);
			});

			this.logger.debug(`Found ${logEntries.length} entries using multi-line parsing`);
			return { logEntries };
		} catch (error) {
			this.logger.error(`Error reading log file: ${error}`);
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
				_timestamp1, finishReason,
				_timestamp2, requestId, _modelDeploymentId,
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
				this.logger.error(`Error parsing multi-line match: ${error}`);
			}
		}

		return entries;
	}

	/**
	 * Start watching the log file for changes
	 * Uses a single *.log pattern watcher to handle creation, changes, and deletion
	 */
	async startWatching(): Promise<void> {
		if (this.isWatching) {
			this.logger.trace('Already watching, skipping');
			return;
		}

		await this.setupLogWatcher();
	}

	/**
	 * Set up unified log watcher using *.log pattern
	 */
	private async setupLogWatcher(): Promise<void> {
		if (!this.extensionContext) {
			this.logger.debug('Cannot set up log watcher - no extension context');
			return;
		}

		try {
			const sessionLogUri = this.extensionContext.logUri;
			const sessionLogDir = sessionLogUri.fsPath;
			const exthostDir = path.dirname(sessionLogDir);
			const copilotLogDir = path.join(exthostDir, 'GitHub.copilot-chat');

			this.logger.trace(`Setting up *.log pattern watcher for: ${copilotLogDir}`);

			this.watcher = new ForceFileWatcher(
				new vscode.RelativePattern(copilotLogDir, '*.log'),
				1000, // Force flush every 1s to catch delayed log writes
				300   // Light debouncing (300ms) to prevent rapid-fire events
			);

			this.watcher.onDidCreate(async (uri) => {
				const createdFile = uri.fsPath;
				this.logger.info(`REAL-TIME: Log file created - ${createdFile}`);
				await this.initializeFilePosition(createdFile);
			});

			this.watcher.onDidChange(async (uri) => {
				const changedFile = uri.fsPath;
				this.logger.trace(`REAL-TIME: Log file changed - ${changedFile}`);
				try {
					const result = await this.scanLogFile(changedFile);
					this.logger.info(`REAL-TIME: Scan complete - ${result.logEntries.length} entries found`);

					// Notify callbacks about new entries
					this.notifyLogUpdateCallbacks(result);
				} catch (error) {
					this.logger.error(`REAL-TIME ERROR during watch scan: ${error}`);
				}
			});

			this.watcher.onDidDelete((uri) => {
				const deletedFile = uri.fsPath;
				this.logger.info(`REAL-TIME: Log file deleted - ${deletedFile}`);
				if (this.currentLogPath === deletedFile) {
					this.logger.trace('Current log file was deleted, resetting position');
					this.lastFilePosition = 0;
					this.currentLogPath = null;
				}
			});

			this.watcher.start();
			this.isWatching = true;
			this.logger.debug('Successfully started *.log pattern watching');
			this.logger.trace(`Watch pattern: ${copilotLogDir}/*.log`);

			// Initialize file position for existing log file if found
			const existingLogPath = await this.findLogPath();
			if (existingLogPath) {
				await this.initializeFilePosition(existingLogPath);
			}
		} catch (error) {
			this.logger.error(`Error setting up log watcher: ${error}`);
		}
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
		this.logger.info('Stopped watching log file');
	}

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
		this.logger.trace('File position reset to beginning');
	}

	/**
	 * Register callback for log updates
	 */
	onLogUpdated(callback: (logResult: LogScanResult) => void): void {
		this.logUpdateCallbacks.push(callback);
		this.logger.trace(`Log update callback registered - now have ${this.logUpdateCallbacks.length} callbacks`);
	}

	/**
	 * Remove log update callback
	 */
	removeLogUpdateCallback(callback: (logResult: LogScanResult) => void): void {
		const index = this.logUpdateCallbacks.indexOf(callback);
		if (index > -1) {
			this.logUpdateCallbacks.splice(index, 1);
			this.logger.trace(`Log update callback removed - now have ${this.logUpdateCallbacks.length} callbacks`);
		}
	}

	/**
	 * Notify callbacks about new log entries
	 */
	private notifyLogUpdateCallbacks(logResult: LogScanResult): void {
		if (logResult.logEntries.length > 0 && this.logUpdateCallbacks.length > 0) {
			this.logger.trace(`Notifying ${this.logUpdateCallbacks.length} callbacks about ${logResult.logEntries.length} new log entries`);
			this.logUpdateCallbacks.forEach((callback, index) => {
				try {
					callback(logResult);
				} catch (error) {
					this.logger.trace(`Log update callback ${index + 1} error: ${error}`);
				}
			});
		}
	}

	/**
	 * Manually trigger a force flush check to catch any delayed writes
	 * Useful when you suspect writes have been buffered
	 */
	async manualForceFlush(): Promise<LogScanResult | null> {
		if (!this.currentLogPath) {
			this.logger.trace('Manual force flush requested but no log path available');
			return null;
		}

		this.logger.trace('Manual force flush triggered');
		try {
			const result = await this.scanLogFile(this.currentLogPath);
			if (result.logEntries.length > 0) {
				this.logger.trace(`Manual force flush found ${result.logEntries.length} entries`);
			} else {
				this.logger.trace('Manual force flush found no new entries');
			}
			return result;
		} catch (error) {
			this.logger.error(`Manual force flush error: ${error}`);
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
