import { UnifiedSessionDataService } from '../../storage/unified-session-data-service';
import { LogEntry } from '../../scanning/copilot-log-scanner';
import { ILogger } from '../../types/logger';

/**
 * Model for Copilot Usage Panel
 * Manages data and business logic, provides observable interface
 */
export class CopilotUsageModel {
	private _listeners: Array<() => void> = [];
	private _logEventCallback: (entries: LogEntry[]) => void;

	// View model
	public stats: Array<{ model: string; count: number; updated: boolean }> = [];
	public totalRequests: number = 0;


	constructor(
		private readonly unifiedDataService: UnifiedSessionDataService, 
		private readonly _logger: ILogger
	) {
		// Set up callback for log events from unified data service
		this._logEventCallback = (entries: LogEntry[]) => {
			this._logger.info('Log entries updated:', entries);
			try {
				this.processLogEntries(entries);
			} catch (error) {
				this._logger.error('Error processing log entries:', error);
			}
		};

		// Register with unified data service for real-time log updates
		this.unifiedDataService.onLogEntriesUpdated(this._logEventCallback);

		// Initialize stats with current data
		this.initializeStats();
	}

	/**
	 * Initialize stats from current unified data service data
	 */
	private async initializeStats(): Promise<void> {
		try {
			const entries = await this.unifiedDataService.getLogEntries();
			this.processLogEntries(entries);
		} catch (error) {
			console.error('Error initializing stats:', error);
		}
	}

	/**
	 * Process log entries to extract model usage statistics
	 * Accumulates new entries with existing stats data
	 */
	private processLogEntries(entries: LogEntry[]): void {
		this._logger.info(`Processing ${entries.length} new log entries`);

		// Start with existing accumulated counts from current stats
		const modelUsage = new Map<string, number>();
		
		// Initialize with current stats data
		this.stats.forEach(({ model, count }) => {
			modelUsage.set(model, count);
		});

		// Add new entries to accumulated counts
		entries.forEach(entry => {
			if (entry.modelName) {
				const currentCount = modelUsage.get(entry.modelName) || 0;
				modelUsage.set(entry.modelName, currentCount + 1);
			}
		});

		const totalRequests = Array.from(modelUsage.values()).reduce((sum, count) => sum + count, 0);

		// Create updated stats array with change detection using existing stats
		const stats = Array.from(modelUsage.entries())
			.map(([model, count]) => {
				const previousStat = this.stats.find(s => s.model === model);
				const previousCount = previousStat?.count || 0;
				return {
					model,
					count,
					updated: previousCount !== count
				};
			})
			.sort((a, b) => b.count - a.count);

		this.stats = stats;
		this.totalRequests = totalRequests;

		this._logger.info(`Updated stats - Total: ${totalRequests} requests across ${stats.length} models`);

		// Notify all listeners (lightweight notification)
		try {
			this._listeners.forEach(listener => {
				this._logger.trace('Notifying listener:', listener);
				return listener();
			});
		} catch (error) {
			this._logger.error('Error notifying listeners:', error);
		}
	}

	/**
	 * Subscribe to changes in data
	 */
	public onDataChanged(listener: () => void): void {
		this._listeners.push(listener);
	}

	/**
	 * Clear all usage statistics
	 */
	public async clearStats(): Promise<void> {
		// TODO: Implement clear functionality in unified data service
		// For now, we'll need to clear the underlying data
		console.warn('Clear stats not yet implemented for unified data service');

		this.stats = [];
		this.totalRequests = 0;

		// Notify listeners
		this._listeners.forEach(listener => listener());
	}

	/**
	 * Refresh statistics from the data source
	 */
	public async refreshStats(): Promise<void> {
		try {
			const entries = await this.unifiedDataService.getLogEntries(true); // Force refresh
			this.processLogEntries(entries);
		} catch (error) {
			console.error('Error refreshing stats:', error);
		}
	}

	/**
	 * Check if there is any usage data
	 */
	public hasData(): boolean {
		return this.stats.length > 0;
	}

	/**
	 * Dispose of the model and clean up listeners
	 */
	public dispose(): void {
		// Remove callback from unified data service
		this.unifiedDataService.removeLogEventCallback(this._logEventCallback);

		// Clear local listeners
		this._listeners = [];
	}
}
