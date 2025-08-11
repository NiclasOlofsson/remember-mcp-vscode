/**
 * Unified Session Data Service - Dual-stream data provider for Copilot events
 * Provides two distinct event streams:
 * 1. Session Events: Complete turn-based data from session JSON files  
 * 2. Log Events: Real-time request-level data from log files
 */

import * as vscode from 'vscode';
import { Mutex } from 'async-mutex';
import { CopilotUsageEvent } from '../types/usage-events';
import { ChatSessionScanner } from '../scanning/chat-session-scanner';
import { SessionDataTransformer } from '../scanning/session-data-transformer';
import { CopilotLogScanner, LogScanResult, LogEntry } from '../scanning/copilot-log-scanner';
import { SessionScanResult, SessionScanStats } from '../types/chat-session';
import { ILogger } from '../types/logger';

export interface SessionDataServiceOptions {
	enableRealTimeUpdates?: boolean;
	enableLogScanning?: boolean;
	debounceMs?: number;
	extensionContext?: vscode.ExtensionContext;
}

export class UnifiedSessionDataService {
	private sessionScanner: ChatSessionScanner;
	private sessionTransformer: SessionDataTransformer;
	private logScanner?: CopilotLogScanner;
	private isWatchingEnabled = false;
	private isInitialized = false;
    
	// Mutexes to prevent race conditions
	private initializationMutex = new Mutex();
	private scanMutex = new Mutex();
	private sessionUpdateMutex = new Mutex();
    
	// Separate callback arrays for different event types
	private sessionEventCallbacks: Array<(events: CopilotUsageEvent[]) => void> = [];
	private logEventCallbacks: Array<(entries: LogEntry[]) => void> = [];
    
	// Separate caches for different data types
	private cachedSessionEvents: CopilotUsageEvent[] = [];
	private cachedLogEntries: LogEntry[] = [];
	private lastScanStats?: SessionScanStats;

	constructor(
		private readonly logger: ILogger,
		private readonly extensionVersion: string,
		private readonly options: SessionDataServiceOptions = {}
	) {
		this.sessionScanner = new ChatSessionScanner(logger, {
			enableWatching: options.enableRealTimeUpdates ?? true,
			debounceMs: options.debounceMs ?? 500,
			maxRetries: 3
		});
        
		this.sessionTransformer = new SessionDataTransformer(
			logger,
			extensionVersion
		);

		// Initialize log scanning if enabled and extension context provided
		if (options.enableLogScanning && options.extensionContext) {
			this.logScanner = new CopilotLogScanner(
				logger,
				options.extensionContext
			);
		}
	}

	/**
     * Initialize the service and perform initial data scan
     * Protected against race conditions with mutex
     */
	async initialize(): Promise<{ sessionEvents: CopilotUsageEvent[]; logEntries: LogEntry[]; stats: SessionScanStats }> {
		return await this.initializationMutex.runExclusive(async () => {
			if (this.isInitialized) {
				this.logger.trace('Already initialized, returning cached data');
				return {
					sessionEvents: this.cachedSessionEvents,
					logEntries: this.cachedLogEntries,
					stats: this.lastScanStats || {
						totalSessions: 0,
						totalRequests: 0,
						scannedFiles: 0,
						errorFiles: 0,
						scanDuration: 0
					}
				};
			}

			this.logger.debug('Initializing UnifiedSessionDataService...');
            
			const scanResult = await this.scanAllData();
            
			if (this.options.enableRealTimeUpdates) {
				this.startRealTimeUpdates();
			}
            
			this.isInitialized = true;
			this.logger.info(`Initialized with ${scanResult.sessionEvents.length} session events, ${scanResult.logEntries.length} log entries`);
			return scanResult;
		});
	}

	/**
     * Scan all session files and log files separately
     * Protected against concurrent scans with mutex
     */
	async scanAllData(): Promise<{ sessionEvents: CopilotUsageEvent[]; logEntries: LogEntry[]; stats: SessionScanStats }> {
		return await this.scanMutex.runExclusive(async () => {
			try {
				// Scan session files
				const { results, stats } = await this.sessionScanner.scanAllSessions();
                
				// Transform session data to events
				const sessionEvents: CopilotUsageEvent[] = [];
				for (const sessionResult of results) {
					const events = await this.sessionTransformer.transformSessionToEvents(sessionResult);
					sessionEvents.push(...events);
				}

				// Sort session events by timestamp
				sessionEvents.sort((a: CopilotUsageEvent, b: CopilotUsageEvent) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

				// No initial log scanning - we only watch log files for real-time events
				const logEntries: LogEntry[] = [];
                
				// Cache the results separately
				this.cachedSessionEvents = sessionEvents;
				this.cachedLogEntries = logEntries;
				this.lastScanStats = stats;
                
				this.logger.trace(`Scanned ${results.length} sessions, generated ${sessionEvents.length} session events and ${logEntries.length} log entries`);
                
				return { sessionEvents, logEntries, stats };
			} catch (error) {
				this.logger.error(`Scan failed: ${error}`);
				throw error;
			}
		});
	}

	/**
     * Get current session events (complete turn-based data)
     */
	async getSessionEvents(forceRefresh = false): Promise<CopilotUsageEvent[]> {
		if (forceRefresh || this.cachedSessionEvents.length === 0) {
			const { sessionEvents } = await this.scanAllData();
			return sessionEvents;
		}
		return this.cachedSessionEvents;
	}

	/**
     * Get current log entries (real-time request-level data)
     */
	async getLogEntries(forceRefresh = false): Promise<LogEntry[]> {
		if (forceRefresh || this.cachedLogEntries.length === 0) {
			const { logEntries } = await this.scanAllData();
			return logEntries;
		}
		return this.cachedLogEntries;
	}

	/**
     * Get last scan statistics
     */
	getLastScanStats(): SessionScanStats | undefined {
		return this.lastScanStats;
	}

	/**
     * Subscribe to session event updates (complete turn-based data)
     */
	onSessionEventsUpdated(callback: (events: CopilotUsageEvent[]) => void): void {
		this.sessionEventCallbacks.push(callback);
		this.logger.trace(`Session callback added - now have ${this.sessionEventCallbacks.length} callbacks`);
	}

	/**
     * Subscribe to log entry updates (real-time request-level data)
     */
	onLogEntriesUpdated(callback: (entries: LogEntry[]) => void): void {
		this.logEventCallbacks.push(callback);
		this.logger.trace(`Log callback added - now have ${this.logEventCallbacks.length} callbacks`);
	}

	/**
     * Remove session event callback
     */
	removeSessionEventCallback(callback: (events: CopilotUsageEvent[]) => void): void {
		const index = this.sessionEventCallbacks.indexOf(callback);
		if (index > -1) {
			this.sessionEventCallbacks.splice(index, 1);
		}
	}

	/**
     * Remove log entry callback
     */
	removeLogEventCallback(callback: (entries: LogEntry[]) => void): void {
		const index = this.logEventCallbacks.indexOf(callback);
		if (index > -1) {
			this.logEventCallbacks.splice(index, 1);
		}
	}

	/**
     * Start real-time monitoring for session file changes
     */
	private startRealTimeUpdates(): void {
		if (this.isWatchingEnabled) {
			return;
		}

		// Start watching session files
		this.logger.info(`Starting session file watching with ${this.sessionEventCallbacks.length} callbacks`);
		this.sessionScanner.startWatching(async (sessionResult: SessionScanResult) => {
			try {
				this.logger.trace(`REAL-TIME  Received session ${sessionResult.session.sessionId}`);
                
				// Transform new/updated session to events
				const newEvents = await this.sessionTransformer.transformSessionToEvents(sessionResult);
				this.logger.trace(`REAL-TIME  Transformed to ${newEvents.length} events`);
                
				// Update cached session events (replace events from same session) - protected by mutex
				await this.sessionUpdateMutex.runExclusive(async () => {
					const beforeCount = this.cachedSessionEvents.length;
					this.cachedSessionEvents = this.cachedSessionEvents.filter(
						(event: CopilotUsageEvent) => event.sessionId !== sessionResult.session.sessionId
					);
					this.cachedSessionEvents.push(...newEvents);
                    
					// Sort by timestamp
					this.cachedSessionEvents.sort((a: CopilotUsageEvent, b: CopilotUsageEvent) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                    
					this.logger.trace(`REAL-TIME  Cache updated from ${beforeCount} to ${this.cachedSessionEvents.length} events`);
				});
                
				// Notify session event callbacks
				this.logger.trace(`REAL-TIME  Notifying ${this.sessionEventCallbacks.length} callbacks`);
				this.sessionEventCallbacks.forEach((callback, index) => {
					try {
						this.logger.trace(`REAL-TIME  Calling callback ${index + 1}/${this.sessionEventCallbacks.length}`);
						callback(this.cachedSessionEvents);
					} catch (error) {
						this.logger.error(` ${error}`);
					}
				});
                
				this.logger.info(`REAL-TIME  Session update complete - ${newEvents.length} events from session ${sessionResult.session.sessionId}`);
			} catch (error) {
				this.logger.error(`Error processing session update: ${error}`);
			}
		});

		// Start watching log files if enabled
		if (this.logScanner) {
			this.logger.info(`Starting log file watching with ${this.logEventCallbacks.length} callbacks`);
            
			// Register callback for log updates
			this.logScanner.onLogUpdated(async (logResult: LogScanResult) => {
				try {
					this.logger.trace(`REAL-TIME  Received ${logResult.logEntries.length} log entries`);
                    
					if (logResult.logEntries.length > 0) {
						// Update cached log entries 
						const beforeCount = this.cachedLogEntries.length;
                        
						// Add only new entries (avoid duplicates by checking timestamp and requestId)
						const newEntries = logResult.logEntries.filter(newEntry => 
							!this.cachedLogEntries.some(existingEntry => 
								existingEntry.requestId === newEntry.requestId && 
                                existingEntry.timestamp.getTime() === newEntry.timestamp.getTime()
							)
						);
                        
						if (newEntries.length > 0) {
							this.cachedLogEntries.push(...newEntries);
                            
							// Sort by timestamp
							this.cachedLogEntries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
                            
							this.logger.trace(`REAL-TIME  Cache updated from ${beforeCount} to ${this.cachedLogEntries.length} entries (${newEntries.length} new)`);
                            
							// Notify log event callbacks with new entries
							this.logger.trace(`REAL-TIME  Notifying ${this.logEventCallbacks.length} callbacks`);
							this.logEventCallbacks.forEach((callback, index) => {
								try {
									this.logger.trace(`REAL-TIME  Calling log callback ${index + 1}/${this.logEventCallbacks.length}`);
									callback(newEntries); // Pass only new entries, not all cached entries
								} catch (error) {
									this.logger.error(` ${error}`);
								}
							});
						}
					}
                    
					this.logger.info(`REAL-TIME  Log update complete - ${logResult.logEntries.length} entries processed`);
				} catch (error) {
					this.logger.error(`Error processing log update: ${error}`);
				}
			});
            
			// Start the log scanner watcher
			this.logScanner.startWatching();
		}

		this.isWatchingEnabled = true;
		this.logger.info('Real-time updates enabled');
	}

	/**
     * Stop real-time monitoring
     */
	stopRealTimeUpdates(): void {
		if (!this.isWatchingEnabled) {
			return;
		}

		this.sessionScanner.stopWatching();
		if (this.logScanner) {
			this.logScanner.stopWatching();
		}
		this.isWatchingEnabled = false;
		this.logger.info('Real-time updates disabled');
	}

	/**
     * Get watcher status
     */
	getWatcherStatus(): { 
		isWatching: boolean; 
		sessionCallbackCount: number; 
		logCallbackCount: number;
	} {
		return {
			isWatching: this.isWatchingEnabled,
			sessionCallbackCount: this.sessionEventCallbacks.length,
			logCallbackCount: this.logEventCallbacks.length
		};
	}

	/**
     * Force refresh current session events (useful for testing)
     */
	async refreshSessionEvents(): Promise<CopilotUsageEvent[]> {
		return this.getSessionEvents(true);
	}

	/**
     * Force refresh current log entries (useful for testing)
     */
	async refreshLogEntries(): Promise<LogEntry[]> {
		return this.getLogEntries(true);
	}

	/**
     * Clean up resources
     */
	dispose(): void {
		this.stopRealTimeUpdates();
		this.sessionEventCallbacks = [];
		this.logEventCallbacks = [];
		this.sessionScanner.dispose();
		if (this.logScanner) {
			this.logScanner.dispose();
		}
		this.isInitialized = false;
		this.logger.debug('Service disposed');
	}

	/**
     * Reset initialization state (for testing/debugging)
     * Protected against race conditions with mutex
     */
	async resetInitialization(): Promise<void> {
		await this.initializationMutex.runExclusive(async () => {
			this.isInitialized = false;
			this.stopRealTimeUpdates();
			this.logger.debug('Initialization state reset');
		});
	}
}
