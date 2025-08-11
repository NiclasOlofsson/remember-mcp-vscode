import { UnifiedSessionDataService } from '../../storage/unified-session-data-service';
import { CopilotUsageEvent } from '../../types/usage-events';

/**
 * Data structure for usage statistics
 */
export interface UsageStats {
	readonly modelUsage: Map<string, number>;
	readonly totalRequests: number;
	readonly sortedStats: [string, number][];
	readonly isDataAvailable: boolean;
}

/**
 * Model for Copilot Usage Panel
 * Manages data and business logic, provides observable interface
 */
export class CopilotUsageModel {
	private _usageStats: UsageStats | null = null;
	private _listeners: Array<(stats: UsageStats) => void> = [];
	private _sessionEventCallback: (events: CopilotUsageEvent[]) => void;

	constructor(private readonly unifiedDataService: UnifiedSessionDataService) {
		// Set up callback for session events from unified data service
		this._sessionEventCallback = (events: CopilotUsageEvent[]) => {
			this.processSessionEvents(events);
		};
		
		// Register with unified data service for real-time updates
		this.unifiedDataService.onSessionEventsUpdated(this._sessionEventCallback);
        
		// Initialize stats with current data
		this.initializeStats();
	}

	/**
     * Initialize stats from current unified data service data
     */
	private async initializeStats(): Promise<void> {
		try {
			const events = await this.unifiedDataService.getSessionEvents();
			this.processSessionEvents(events);
		} catch (error) {
			console.error('Error initializing stats:', error);
			// Initialize with empty stats on error
			this._usageStats = {
				modelUsage: new Map(),
				totalRequests: 0,
				sortedStats: [],
				isDataAvailable: false
			};
		}
	}

	/**
     * Process session events to extract model usage statistics
     */
	private processSessionEvents(events: CopilotUsageEvent[]): void {
		const modelUsage = new Map<string, number>();
		
		// Count model usage from events
		events.forEach(event => {
			if (event.model) {
				const currentCount = modelUsage.get(event.model) || 0;
				modelUsage.set(event.model, currentCount + 1);
			}
		});

		const totalRequests = Array.from(modelUsage.values()).reduce((sum, count) => sum + count, 0);
		const sortedStats = Array.from(modelUsage.entries()).sort((a, b) => b[1] - a[1]);
		const isDataAvailable = totalRequests > 0;

		this._usageStats = {
			modelUsage,
			totalRequests,
			sortedStats,
			isDataAvailable
		};

		// Notify all listeners
		this._listeners.forEach(listener => listener(this._usageStats!));
	}

	/**
     * Get current usage statistics
     */
	public get usageStats(): UsageStats {
		if (!this._usageStats) {
			// Return empty stats if not initialized yet
			return {
				modelUsage: new Map(),
				totalRequests: 0,
				sortedStats: [],
				isDataAvailable: false
			};
		}
		return this._usageStats;
	}

	/**
     * Subscribe to changes in data
     */
	public onDataChanged(listener: (stats: UsageStats) => void): void {
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
			modelUsage: new Map(),
			totalRequests: 0,
			sortedStats: [],
			isDataAvailable: false
		};
		
		// Notify listeners
		this._listeners.forEach(listener => listener(this._usageStats!));
	}

	/**
     * Refresh statistics from the data source
     */
	public async refreshStats(): Promise<void> {
		try {
			const events = await this.unifiedDataService.getSessionEvents(true); // Force refresh
			this.processSessionEvents(events);
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
		this.unifiedDataService.removeSessionEventCallback(this._sessionEventCallback);
		
		// Clear local listeners
		this._listeners = [];
	}
}
