import { UnifiedSessionDataService } from '../../storage/unified-session-data-service';
import { LogEntry } from '../../scanning/copilot-log-scanner';

/**
 * Data structure for usage statistics
 */
export interface UsageStats {
	readonly stats: Array<{ model: string; count: number; updated: boolean }>;
	readonly totalRequests: number;
	readonly isDataAvailable: boolean;
}

/**
 * Model for Copilot Usage Panel
 * Manages data and business logic, provides observable interface
 */
export class CopilotUsageModel {
	private _usageStats: UsageStats | null = null;
	private _previousModelCounts: Map<string, number> = new Map();
	private _listeners: Array<() => void> = [];
	private _logEventCallback: (entries: LogEntry[]) => void;

	constructor(private readonly unifiedDataService: UnifiedSessionDataService) {
		// Set up callback for log events from unified data service
		this._logEventCallback = (entries: LogEntry[]) => {
			this.processLogEntries(entries);
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
			// Initialize with empty stats on error
			this._usageStats = {
				stats: [],
				totalRequests: 0,
				isDataAvailable: false
			};
		}
	}

	/**
     * Process log entries to extract model usage statistics
     */
	private processLogEntries(entries: LogEntry[]): void {
		const modelUsage = new Map<string, number>();
		
		// Count model usage from log entries
		entries.forEach(entry => {
			if (entry.modelName) {
				const currentCount = modelUsage.get(entry.modelName) || 0;
				modelUsage.set(entry.modelName, currentCount + 1);
			}
		});

		const totalRequests = Array.from(modelUsage.values()).reduce((sum, count) => sum + count, 0);
		const isDataAvailable = totalRequests > 0;

		// Create stats array with update detection
		const stats = Array.from(modelUsage.entries())
			.map(([model, count]) => ({
				model,
				count,
				updated: this._previousModelCounts.get(model) !== count
			}))
			.sort((a, b) => b.count - a.count);

		// Update previous counts for next comparison
		this._previousModelCounts = new Map(modelUsage);

		this._usageStats = {
			stats,
			totalRequests,
			isDataAvailable
		};

		// Notify all listeners (lightweight notification)
		this._listeners.forEach(listener => listener());
	}

	/**
     * Get current usage statistics
     */
	public get usageStats(): UsageStats {
		if (!this._usageStats) {
			// Return empty stats if not initialized yet
			return {
				stats: [],
				totalRequests: 0,
				isDataAvailable: false
			};
		}
		return this._usageStats;
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
		
		// Reset local stats to empty
		this._usageStats = {
			stats: [],
			totalRequests: 0,
			isDataAvailable: false
		};
		
		// Reset previous counts
		this._previousModelCounts.clear();
		
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
		return this.usageStats.isDataAvailable;
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
