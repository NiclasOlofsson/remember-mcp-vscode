/**
 * Enhanced Analytics Engine - Unified data processing and analytics interface
 * Combines storage management and analytics computation with in-memory caching
 * Replaces both UsageStorageManager and AnalyticsEngine as per architecture refactor
 */

import * as vscode from 'vscode';
import { CopilotUsageEvent, UsageStorageIndex, CopilotUsageSettings, DEFAULT_USAGE_SETTINGS, DateRange } from '../types/usage-events';
import { UnifiedSessionDataService } from './unified-session-data-service';
import { SessionScanStats } from '../types/chat-session';
import { LogEntry } from '../scanning/copilot-log-scanner';
import { ILogger } from '../types/logger';
import { ServiceContainer } from '../types/service-container';
import { 
	AnalyticsQuery, 
	AnalyticsResult, 
	AggregatedMetrics, 
	TimeSeriesDataPoint, 
	LanguageUsageMetric, 
	ModelUsageMetric, 
	EventTypeDistribution, 
	HourlyDistribution, 
	DayOfWeekDistribution, 
	SessionAnalytics,
	VSCodeSessionAnalytics,
	WindowSessionAnalytics 
} from '../types/analytics';

interface CacheEntry<T> {
	data: T;
	timestamp: number;
	key: string;
}

interface StorageStats {
	totalEvents: number;
	totalFiles: number;
	totalSizeBytes: number;
	oldestEvent?: string;
	newestEvent?: string;
}

export class EnhancedAnalyticsEngine {
	private static readonly STORAGE_KEY = 'copilot-usage-index';
	private static readonly SESSION_SCAN_KEY = 'copilot-session-scan-stats';
	private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
	private static readonly MAX_CACHE_ENTRIES = 100;
	private static readonly DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

	private context: vscode.ExtensionContext;
	private unifiedDataService: UnifiedSessionDataService;
	
	// In-memory cache for computed analytics and events
	private analyticsCache = new Map<string, CacheEntry<any>>();
	private eventsCache = new Map<string, CacheEntry<CopilotUsageEvent[]>>();
	
	// Real-time callbacks (matching UsageStorageManager interface)
	private sessionEventCallbacks: Array<(events: CopilotUsageEvent[]) => void> = [];
	private logEventCallbacks: Array<(entries: LogEntry[]) => void> = [];

	constructor(context: vscode.ExtensionContext, logger: ILogger) {
		this.context = context;
		
		// Get the shared unified session data service from the service container
		if (!ServiceContainer.isInitialized()) {
			throw new Error('ServiceContainer must be initialized before creating EnhancedAnalyticsEngine');
		}
		
		this.unifiedDataService = ServiceContainer.getInstance().getUnifiedSessionDataService();
		logger.info('EnhancedAnalyticsEngine initialized with shared UnifiedSessionDataService');
	}

	/**
	 * Initialize the analytics engine
	 */
	async initialize(): Promise<void> {
		// Initialize the unified data service
		await this.unifiedDataService.initialize();
		
		// Set up real-time callbacks for cache updates
		this.unifiedDataService.onSessionEventsUpdated(async (events) => {
			// Invalidate relevant caches when new data arrives
			this.invalidateEventsCache();
			this.invalidateAnalyticsCache();
			
			// Forward to registered callbacks
			this.sessionEventCallbacks.forEach(callback => {
				try {
					callback(events);
				} catch (error) {
					console.error('Error in session event callback:', error);
				}
			});
		});
		
		this.unifiedDataService.onLogEntriesUpdated((entries) => {
			// Forward to registered callbacks (log entries are real-time only)
			this.logEventCallbacks.forEach(callback => {
				try {
					callback(entries);
				} catch (error) {
					console.error('Error in log event callback:', error);
				}
			});
		});
	}

	/**
	 * Get events for a specific date range (with caching)
	 */
	async getEventsForDateRange(dateRange: DateRange): Promise<CopilotUsageEvent[]> {
		const cacheKey = `events-${dateRange.start.toISOString()}-${dateRange.end.toISOString()}`;
		
		// Check cache first
		const cached = this.getCachedData(this.eventsCache, cacheKey);
		if (cached) {
			return cached;
		}
		
		// Get all session events from unified data service
		const allEvents = await this.unifiedDataService.getSessionEvents();
		
		// Filter events within the date range
		const filteredEvents = allEvents.filter(event => {
			const eventTime = new Date(event.timestamp);
			return eventTime >= dateRange.start && eventTime <= dateRange.end;
		});
		
		// Sort by timestamp
		const sortedEvents = filteredEvents.sort((a, b) => 
			new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
		);
		
		// Cache the result
		this.setCachedData(this.eventsCache, cacheKey, sortedEvents);
		
		return sortedEvents;
	}

	/**
	 * Get all events (cached)
	 */
	async getAllEvents(): Promise<CopilotUsageEvent[]> {
		const cacheKey = 'all-events';
		
		// Check cache first
		const cached = this.getCachedData(this.eventsCache, cacheKey);
		if (cached) {
			return cached;
		}
		
		// Get all session events from unified data service
		const allEvents = await this.unifiedDataService.getSessionEvents();
		
		// Sort by timestamp
		const sortedEvents = allEvents.sort((a, b) => 
			new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
		);
		
		// Cache the result
		this.setCachedData(this.eventsCache, cacheKey, sortedEvents);
		
		return sortedEvents;
	}

	/**
	 * Calculate comprehensive analytics for given events and query (with caching)
	 */
	async calculateAnalytics(events: CopilotUsageEvent[], query: AnalyticsQuery): Promise<AnalyticsResult> {
		const cacheKey = `analytics-${JSON.stringify(query)}-${events.length}-${this.getEventsHash(events)}`;
		
		// Check cache first
		const cached = this.getCachedData(this.analyticsCache, cacheKey);
		if (cached) {
			return cached;
		}
		
		// Filter events based on query
		const filteredEvents = this.filterEvents(events, query);
		
		const result: AnalyticsResult = {
			query,
			aggregatedMetrics: this.calculateAggregatedMetrics(filteredEvents),
			timeSeriesData: this.calculateTimeSeriesData(filteredEvents, query.dateRange),
			languageMetrics: this.calculateLanguageMetrics(filteredEvents),
			modelMetrics: this.calculateModelMetrics(filteredEvents),
			eventTypeDistribution: this.calculateEventTypeDistribution(filteredEvents),
			hourlyDistribution: this.calculateHourlyDistribution(filteredEvents),
			dayOfWeekDistribution: this.calculateDayOfWeekDistribution(filteredEvents),
			sessionAnalytics: this.calculateSessionAnalytics(filteredEvents),
			vscodeSessionAnalytics: this.calculateVSCodeSessionAnalytics(filteredEvents),
			windowSessionAnalytics: this.calculateWindowSessionAnalytics(filteredEvents),
			generatedAt: new Date().toISOString()
		};
		
		// Cache the result
		this.setCachedData(this.analyticsCache, cacheKey, result);
		
		return result;
	}

	/**
	 * Calculate quick dashboard statistics (with caching)
	 */
	async calculateQuickStats(events: CopilotUsageEvent[]): Promise<{
		totalEvents: number;
		eventsToday: number;
		eventsThisWeek: number;
		eventsThisMonth: number;
		averageSessionDuration: string;
		topLanguage: string;
		topModel: string;
		lastEventTime?: string;
	}> {
		const cacheKey = `quick-stats-${events.length}-${this.getEventsHash(events)}`;
		
		// Check cache first
		const cached = this.getCachedData(this.analyticsCache, cacheKey);
		if (cached) {
			return cached;
		}
		
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const thisWeek = new Date(now.getTime() - (now.getDay() * 24 * 60 * 60 * 1000));
		const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

		const eventsToday = events.filter(e => new Date(e.timestamp) >= today).length;
		const eventsThisWeek = events.filter(e => new Date(e.timestamp) >= thisWeek).length;
		const eventsThisMonth = events.filter(e => new Date(e.timestamp) >= thisMonth).length;

		// Calculate average session duration
		const sessionAnalytics = this.calculateSessionAnalytics(events);
		const avgDuration = sessionAnalytics.length > 0 
			? sessionAnalytics.reduce((sum, s) => sum + s.duration, 0) / sessionAnalytics.length
			: 0;

		// Get top language and model
		const languageMetrics = this.calculateLanguageMetrics(events);
		const modelMetrics = this.calculateModelMetrics(events);
		
		const topLanguage = languageMetrics.length > 0 ? languageMetrics[0].language : 'None';
		const topModel = modelMetrics.length > 0 ? modelMetrics[0].model : 'None';

		// Get last event time
		const lastEvent = events.length > 0 ? events[events.length - 1] : null;
		const lastEventTime = lastEvent ? this.formatRelativeTime(new Date(lastEvent.timestamp)) : undefined;

		const result = {
			totalEvents: events.length,
			eventsToday,
			eventsThisWeek,
			eventsThisMonth,
			averageSessionDuration: this.formatDuration(avgDuration),
			topLanguage,
			topModel,
			lastEventTime
		};
		
		// Cache the result
		this.setCachedData(this.analyticsCache, cacheKey, result);
		
		return result;
	}

	/**
	 * Get usage settings (delegates to context globalState)
	 */
	async getSettings(): Promise<CopilotUsageSettings> {
		const index = await this.getStorageIndex();
		return index.settings;
	}

	/**
	 * Update usage settings (delegates to context globalState)
	 */
	async updateSettings(settings: Partial<CopilotUsageSettings>): Promise<void> {
		const index = await this.getStorageIndex();
		index.settings = { ...index.settings, ...settings };
		await this.updateStorageIndex(index);
	}

	/**
	 * Get storage statistics (computed from unified data service)
	 */
	async getStorageStats(): Promise<StorageStats> {
		const cacheKey = 'storage-stats';
		
		// Check cache first
		const cached = this.getCachedData(this.analyticsCache, cacheKey);
		if (cached) {
			return cached;
		}
		
		const allEvents = await this.getAllEvents();
		
		let oldestEvent: string | undefined;
		let newestEvent: string | undefined;
		
		if (allEvents.length > 0) {
			oldestEvent = allEvents[0].timestamp;
			newestEvent = allEvents[allEvents.length - 1].timestamp;
		}
		
		const result: StorageStats = {
			totalEvents: allEvents.length,
			totalFiles: 0, // No longer relevant with in-memory approach
			totalSizeBytes: JSON.stringify(allEvents).length, // Approximate memory usage
			oldestEvent,
			newestEvent
		};
		
		// Cache the result
		this.setCachedData(this.analyticsCache, cacheKey, result);
		
		return result;
	}

	/**
	 * Scan chat sessions (delegates to unified data service)
	 */
	async scanChatSessions(): Promise<{ events: CopilotUsageEvent[]; stats: SessionScanStats }> {
		try {
			// Use unified session data service - get session events only
			const { sessionEvents, stats } = await this.unifiedDataService.scanAllData();
			
			// Invalidate caches since we have new data
			this.invalidateEventsCache();
			this.invalidateAnalyticsCache();
			
			// Store scan statistics
			await this.updateSessionScanStats(stats);
			
			return { events: sessionEvents, stats };
		} catch (error) {
			throw new Error(`Session scan failed: ${error}`);
		}
	}

	/**
	 * Real-time session watcher methods (delegate to unified data service)
	 */
	startSessionWatcher(): void {
		// Already handled by unified session data service during initialization
	}

	stopSessionWatcher(): void {
		this.unifiedDataService.stopRealTimeUpdates();
	}

	getSessionWatcherStatus(): { isWatching: boolean; callbackCount: number } {
		const status = this.unifiedDataService.getWatcherStatus();
		return {
			isWatching: status.isWatching,
			callbackCount: status.sessionCallbackCount + status.logCallbackCount
		};
	}

	/**
	 * Get current session events from unified service
	 */
	async getCurrentSessionEvents(): Promise<CopilotUsageEvent[]> {
		return this.unifiedDataService.getSessionEvents();
	}

	/**
	 * Get current log entries from unified service
	 */
	async getCurrentLogEntries(): Promise<LogEntry[]> {
		return this.unifiedDataService.getLogEntries();
	}

	/**
	 * Session scan statistics methods
	 */
	async getSessionScanStats(): Promise<SessionScanStats | null> {
		return this.context.globalState.get<SessionScanStats>(EnhancedAnalyticsEngine.SESSION_SCAN_KEY) || null;
	}

	private async updateSessionScanStats(stats: SessionScanStats): Promise<void> {
		await this.context.globalState.update(EnhancedAnalyticsEngine.SESSION_SCAN_KEY, stats);
	}

	/**
	 * Clear all cached data (development feature)
	 */
	async clearStorage(): Promise<{ deletedFiles: number; deletedEvents: number }> {
		// Clear in-memory caches
		this.invalidateEventsCache();
		this.invalidateAnalyticsCache();
		
		// Get count of events before clearing
		const allEvents = await this.unifiedDataService.getSessionEvents();
		const deletedEvents = allEvents.length;
		
		// Reset storage index
		const clearedIndex: UsageStorageIndex = {
			totalEvents: 0,
			lastUpdate: new Date().toISOString(),
			eventFiles: [],
			settings: DEFAULT_USAGE_SETTINGS
		};
		
		await this.updateStorageIndex(clearedIndex);
		
		return { deletedFiles: 0, deletedEvents }; // No files with in-memory approach
	}

	/**
	 * Callback management methods (maintain interface compatibility)
	 */
	onSessionEventsUpdated(callback: (events: CopilotUsageEvent[]) => void): void {
		this.sessionEventCallbacks.push(callback);
	}

	onLogEntriesUpdated(callback: (entries: LogEntry[]) => void): void {
		this.logEventCallbacks.push(callback);
	}

	removeSessionEventCallback(callback: (events: CopilotUsageEvent[]) => void): void {
		const index = this.sessionEventCallbacks.indexOf(callback);
		if (index > -1) {
			this.sessionEventCallbacks.splice(index, 1);
		}
	}

	removeLogEventCallback(callback: (entries: LogEntry[]) => void): void {
		const index = this.logEventCallbacks.indexOf(callback);
		if (index > -1) {
			this.logEventCallbacks.splice(index, 1);
		}
	}

	/**
	 * Private helper methods for analytics computation
	 */
	private filterEvents(events: CopilotUsageEvent[], query: AnalyticsQuery): CopilotUsageEvent[] {
		return events.filter(event => {
			const eventTime = new Date(event.timestamp);
			
			// Date range filter
			if (eventTime < query.dateRange.start || eventTime > query.dateRange.end) {
				return false;
			}
			
			// Event types filter
			if (query.eventTypes && query.eventTypes.length > 0 && !query.eventTypes.includes(event.type)) {
				return false;
			}
			
			// Languages filter
			if (query.languages && query.languages.length > 0 && (!event.language || !query.languages.includes(event.language))) {
				return false;
			}
			
			// Models filter
			if (query.models && query.models.length > 0 && (!event.model || !query.models.includes(event.model))) {
				return false;
			}
			
			// Session IDs filter
			if (query.sessionIds && query.sessionIds.length > 0 && !query.sessionIds.includes(event.sessionId)) {
				return false;
			}
			
			return true;
		});
	}

	private calculateAggregatedMetrics(events: CopilotUsageEvent[]): AggregatedMetrics {
		const uniqueSessions = new Set(events.map(e => e.sessionId)).size;
		const totalDuration = events.reduce((sum, e) => sum + (e.duration || 0), 0);
		const totalTokens = events.reduce((sum, e) => sum + (e.tokensUsed || 0), 0);
		
		return {
			totalEvents: events.length,
			uniqueSessions,
			averageEventsPerSession: uniqueSessions > 0 ? events.length / uniqueSessions : 0,
			totalDuration,
			averageDuration: events.length > 0 ? totalDuration / events.length : 0,
			totalTokensUsed: totalTokens,
			averageTokensPerEvent: events.length > 0 ? totalTokens / events.length : 0
		};
	}

	private calculateTimeSeriesData(events: CopilotUsageEvent[], dateRange: DateRange): TimeSeriesDataPoint[] {
		const dataPoints: TimeSeriesDataPoint[] = [];
		const dailyCounts = new Map<string, number>();
		
		// Initialize all dates in range with 0
		const current = new Date(dateRange.start);
		while (current <= dateRange.end) {
			const dateKey = current.toISOString().split('T')[0];
			dailyCounts.set(dateKey, 0);
			current.setDate(current.getDate() + 1);
		}
		
		// Count events per day
		for (const event of events) {
			const dateKey = event.timestamp.split('T')[0];
			const currentCount = dailyCounts.get(dateKey) || 0;
			dailyCounts.set(dateKey, currentCount + 1);
		}
		
		// Convert to time series format
		for (const [date, count] of Array.from(dailyCounts.entries()).sort()) {
			dataPoints.push({
				timestamp: date,
				value: count
			});
		}
		
		return dataPoints;
	}

	private calculateLanguageMetrics(events: CopilotUsageEvent[]): LanguageUsageMetric[] {
		const languageCounts = new Map<string, { count: number; totalDuration: number; totalTokens: number }>();
		
		// Debug: Log language distribution for troubleshooting
		const languageDebug = new Map<string, number>();
		
		for (const event of events) {
			const language = event.language || 'unknown';
			const current = languageCounts.get(language) || { count: 0, totalDuration: 0, totalTokens: 0 };
			
			current.count++;
			current.totalDuration += event.duration || 0;
			current.totalTokens += event.tokensUsed || 0;
			
			languageCounts.set(language, current);
			
			// Debug tracking
			languageDebug.set(language, (languageDebug.get(language) || 0) + 1);
		}
		
		// Log debug information about language detection
		console.log('Language distribution debug:', Object.fromEntries(languageDebug));
		if (languageDebug.get('unknown') === events.length) {
			console.warn('All events have unknown language - language detection may need enhancement');
		}
		
		const totalEvents = events.length;
		
		return Array.from(languageCounts.entries())
			.map(([language, data]) => ({
				language,
				eventCount: data.count,
				percentage: totalEvents > 0 ? (data.count / totalEvents) * 100 : 0,
				averageDuration: data.count > 0 ? data.totalDuration / data.count : 0,
				totalTokens: data.totalTokens
			}))
			.sort((a, b) => b.eventCount - a.eventCount);
	}

	private calculateModelMetrics(events: CopilotUsageEvent[]): ModelUsageMetric[] {
		const modelCounts = new Map<string, { count: number; totalDuration: number; totalTokens: number }>();
		
		for (const event of events) {
			const model = event.model || 'Unknown';
			const current = modelCounts.get(model) || { count: 0, totalDuration: 0, totalTokens: 0 };
			
			current.count++;
			current.totalDuration += event.duration || 0;
			current.totalTokens += event.tokensUsed || 0;
			
			modelCounts.set(model, current);
		}
		
		const totalEvents = events.length;
		
		return Array.from(modelCounts.entries())
			.map(([model, data]) => ({
				model,
				eventCount: data.count,
				percentage: totalEvents > 0 ? (data.count / totalEvents) * 100 : 0,
				averageDuration: data.count > 0 ? data.totalDuration / data.count : 0,
				totalTokens: data.totalTokens,
				successRate: 100 // Assume all logged events were successful
			}))
			.sort((a, b) => b.eventCount - a.eventCount);
	}

	private calculateEventTypeDistribution(events: CopilotUsageEvent[]): EventTypeDistribution[] {
		const typeCounts = new Map<string, number>();
		
		for (const event of events) {
			const current = typeCounts.get(event.type) || 0;
			typeCounts.set(event.type, current + 1);
		}
		
		const totalEvents = events.length;
		
		return Array.from(typeCounts.entries())
			.map(([type, count]) => ({
				type,
				count,
				percentage: totalEvents > 0 ? (count / totalEvents) * 100 : 0
			}))
			.sort((a, b) => b.count - a.count);
	}

	private calculateHourlyDistribution(events: CopilotUsageEvent[]): HourlyDistribution[] {
		const hourlyCounts = new Map<number, number>();
		
		// Initialize all hours
		for (let hour = 0; hour < 24; hour++) {
			hourlyCounts.set(hour, 0);
		}
		
		for (const event of events) {
			const hour = new Date(event.timestamp).getHours();
			const current = hourlyCounts.get(hour) || 0;
			hourlyCounts.set(hour, current + 1);
		}
		
		const totalEvents = events.length;
		
		return Array.from(hourlyCounts.entries())
			.map(([hour, count]) => ({
				hour,
				eventCount: count,
				percentage: totalEvents > 0 ? (count / totalEvents) * 100 : 0
			}))
			.sort((a, b) => a.hour - b.hour);
	}

	private calculateDayOfWeekDistribution(events: CopilotUsageEvent[]): DayOfWeekDistribution[] {
		const dayOfWeekCounts = new Map<number, number>();
		
		// Initialize all days
		for (let day = 0; day < 7; day++) {
			dayOfWeekCounts.set(day, 0);
		}
		
		for (const event of events) {
			const dayOfWeek = new Date(event.timestamp).getDay();
			const current = dayOfWeekCounts.get(dayOfWeek) || 0;
			dayOfWeekCounts.set(dayOfWeek, current + 1);
		}
		
		const totalEvents = events.length;
		
		return Array.from(dayOfWeekCounts.entries())
			.map(([dayOfWeek, count]) => ({
				dayOfWeek,
				dayName: EnhancedAnalyticsEngine.DAY_NAMES[dayOfWeek],
				eventCount: count,
				percentage: totalEvents > 0 ? (count / totalEvents) * 100 : 0
			}))
			.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
	}

	private calculateSessionAnalytics(events: CopilotUsageEvent[]): SessionAnalytics[] {
		const sessionMap = new Map<string, {
			sessionId: string;
			vscodeSessionId: string;
			windowId?: string;
			extensionHostSessionId: string;
			events: CopilotUsageEvent[];
			workspaceId?: string;
		}>();
		
		// Group events by session
		for (const event of events) {
			if (!sessionMap.has(event.sessionId)) {
				sessionMap.set(event.sessionId, {
					sessionId: event.sessionId,
					vscodeSessionId: event.vscodeSessionId,
					windowId: event.windowId,
					extensionHostSessionId: event.extensionHostSessionId,
					events: [],
					workspaceId: event.workspaceId
				});
			}
			sessionMap.get(event.sessionId)!.events.push(event);
		}
		
		// Calculate analytics for each session
		return Array.from(sessionMap.values()).map(session => {
			const sortedEvents = session.events.sort((a, b) => 
				new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
			);
			
			const startTime = sortedEvents[0].timestamp;
			const endTime = sortedEvents[sortedEvents.length - 1].timestamp;
			const duration = new Date(endTime).getTime() - new Date(startTime).getTime();
			
			const uniqueLanguages = Array.from(new Set(
				sortedEvents.map(e => e.language).filter(l => l)
			)) as string[];
			
			const uniqueModels = Array.from(new Set(
				sortedEvents.map(e => e.model).filter(m => m)
			)) as string[];
			
			return {
				sessionId: session.sessionId,
				vscodeSessionId: session.vscodeSessionId,
				windowId: session.windowId,
				extensionHostSessionId: session.extensionHostSessionId,
				startTime,
				endTime: sortedEvents.length > 1 ? endTime : undefined,
				duration,
				eventCount: session.events.length,
				uniqueLanguages,
				uniqueModels,
				workspaceId: session.workspaceId
			};
		}).sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
	}

	private calculateVSCodeSessionAnalytics(events: CopilotUsageEvent[]): VSCodeSessionAnalytics[] {
		const vscodeSessionMap = new Map<string, {
			vscodeSessionId: string;
			events: CopilotUsageEvent[];
			windows: Set<string>;
			extensionHostSessions: Set<string>;
			workspaceIds: Set<string>;
		}>();
		
		// Group events by VS Code session
		for (const event of events) {
			if (!vscodeSessionMap.has(event.vscodeSessionId)) {
				vscodeSessionMap.set(event.vscodeSessionId, {
					vscodeSessionId: event.vscodeSessionId,
					events: [],
					windows: new Set(),
					extensionHostSessions: new Set(),
					workspaceIds: new Set()
				});
			}
			const session = vscodeSessionMap.get(event.vscodeSessionId)!;
			session.events.push(event);
			if (event.windowId) {
				session.windows.add(event.windowId);
			}
			session.extensionHostSessions.add(event.extensionHostSessionId);
			if (event.workspaceId) {
				session.workspaceIds.add(event.workspaceId);
			}
		}
		
		return Array.from(vscodeSessionMap.values()).map(session => {
			const sortedEvents = session.events.sort((a, b) => 
				new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
			);
			
			const startTime = sortedEvents[0].timestamp;
			const endTime = sortedEvents[sortedEvents.length - 1].timestamp;
			const duration = new Date(endTime).getTime() - new Date(startTime).getTime();
			
			const uniqueLanguages = Array.from(new Set(
				sortedEvents.map(e => e.language).filter(l => l)
			)) as string[];
			
			const uniqueModels = Array.from(new Set(
				sortedEvents.map(e => e.model).filter(m => m)
			)) as string[];
			
			return {
				vscodeSessionId: session.vscodeSessionId,
				startTime,
				endTime: sortedEvents.length > 1 ? endTime : undefined,
				duration,
				eventCount: session.events.length,
				windowCount: session.windows.size,
				extensionHostRestarts: session.extensionHostSessions.size - 1, // Restarts = sessions - 1
				uniqueLanguages,
				uniqueModels,
				workspaceIds: Array.from(session.workspaceIds)
			};
		}).sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
	}

	private calculateWindowSessionAnalytics(events: CopilotUsageEvent[]): WindowSessionAnalytics[] {
		const windowSessionMap = new Map<string, {
			vscodeSessionId: string;
			windowId: string;
			events: CopilotUsageEvent[];
			extensionHostSessions: Set<string>;
			workspaceId?: string;
		}>();
		
		// Group events by window
		for (const event of events) {
			if (!event.windowId) {
				continue; // Skip events without window info
			}
			
			const windowKey = `${event.vscodeSessionId}-${event.windowId}`;
			if (!windowSessionMap.has(windowKey)) {
				windowSessionMap.set(windowKey, {
					vscodeSessionId: event.vscodeSessionId,
					windowId: event.windowId,
					events: [],
					extensionHostSessions: new Set(),
					workspaceId: event.workspaceId
				});
			}
			const windowSession = windowSessionMap.get(windowKey)!;
			windowSession.events.push(event);
			windowSession.extensionHostSessions.add(event.extensionHostSessionId);
		}
		
		return Array.from(windowSessionMap.values()).map(windowSession => {
			const sortedEvents = windowSession.events.sort((a, b) => 
				new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
			);
			
			const startTime = sortedEvents[0].timestamp;
			const endTime = sortedEvents[sortedEvents.length - 1].timestamp;
			const duration = new Date(endTime).getTime() - new Date(startTime).getTime();
			
			const uniqueLanguages = Array.from(new Set(
				sortedEvents.map(e => e.language).filter(l => l)
			)) as string[];
			
			const uniqueModels = Array.from(new Set(
				sortedEvents.map(e => e.model).filter(m => m)
			)) as string[];
			
			return {
				vscodeSessionId: windowSession.vscodeSessionId,
				windowId: windowSession.windowId,
				startTime,
				endTime: sortedEvents.length > 1 ? endTime : undefined,
				duration,
				eventCount: windowSession.events.length,
				extensionHostSessions: windowSession.extensionHostSessions.size,
				uniqueLanguages,
				uniqueModels,
				workspaceId: windowSession.workspaceId
			};
		}).sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
	}

	/**
	 * Private helper methods for caching
	 */
	private getCachedData<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
		const entry = cache.get(key);
		if (!entry) {
			return null;
		}
		
		// Check if entry is still valid
		const now = Date.now();
		if (now - entry.timestamp > EnhancedAnalyticsEngine.CACHE_TTL_MS) {
			cache.delete(key);
			return null;
		}
		
		return entry.data;
	}

	private setCachedData<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
		// Implement simple LRU eviction
		if (cache.size >= EnhancedAnalyticsEngine.MAX_CACHE_ENTRIES) {
			// Remove oldest entry
			const oldestKey = cache.keys().next().value;
			if (oldestKey) {
				cache.delete(oldestKey);
			}
		}
		
		cache.set(key, {
			data,
			timestamp: Date.now(),
			key
		});
	}

	private invalidateEventsCache(): void {
		this.eventsCache.clear();
	}

	private invalidateAnalyticsCache(): void {
		this.analyticsCache.clear();
	}

	private getEventsHash(events: CopilotUsageEvent[]): string {
		// Simple hash based on event count and timestamps
		if (events.length === 0) {
			return '0';
		}
		
		const first = events[0]?.timestamp || '';
		const last = events[events.length - 1]?.timestamp || '';
		return `${events.length}-${first}-${last}`;
	}

	/**
	 * Storage index management (for settings persistence)
	 */
	private async getStorageIndex(): Promise<UsageStorageIndex> {
		const stored = this.context.globalState.get<UsageStorageIndex>(EnhancedAnalyticsEngine.STORAGE_KEY);
		
		if (!stored) {
			const defaultIndex: UsageStorageIndex = {
				totalEvents: 0,
				lastUpdate: new Date().toISOString(),
				eventFiles: [],
				settings: DEFAULT_USAGE_SETTINGS
			};
			
			await this.updateStorageIndex(defaultIndex);
			return defaultIndex;
		}
		
		// Ensure settings exist and merge with defaults
		stored.settings = { ...DEFAULT_USAGE_SETTINGS, ...stored.settings };
		return stored;
	}

	private async updateStorageIndex(index: UsageStorageIndex): Promise<void> {
		await this.context.globalState.update(EnhancedAnalyticsEngine.STORAGE_KEY, index);
	}

	/**
	 * Utility methods
	 */
	private formatDuration(durationMs: number): string {
		if (durationMs < 1000) {
			return `${Math.round(durationMs)}ms`;
		} else if (durationMs < 60000) {
			return `${Math.round(durationMs / 1000)}s`;
		} else if (durationMs < 3600000) {
			return `${Math.round(durationMs / 60000)}m`;
		} else {
			return `${Math.round(durationMs / 3600000)}h`;
		}
	}

	private formatRelativeTime(date: Date): string {
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		
		if (diffMs < 60000) {
			return 'Just now';
		} else if (diffMs < 3600000) {
			const minutes = Math.floor(diffMs / 60000);
			return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
		} else if (diffMs < 86400000) {
			const hours = Math.floor(diffMs / 3600000);
			return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
		} else {
			const days = Math.floor(diffMs / 86400000);
			return `${days} day${days !== 1 ? 's' : ''} ago`;
		}
	}

	/**
	 * Cleanup resources
	 */
	dispose(): void {
		this.stopSessionWatcher();
		this.invalidateEventsCache();
		this.invalidateAnalyticsCache();
		this.sessionEventCallbacks = [];
		this.logEventCallbacks = [];
		this.unifiedDataService.dispose();
	}

	/**
	 * Debug method: Analyze language detection issues
	 * Returns detailed information about why languages might be showing as "unknown"
	 */
	async analyzeLanguageDetection(): Promise<{
		totalEvents: number;
		eventsWithLanguage: number;
		eventsWithoutLanguage: number;
		languageDistribution: Record<string, number>;
		sampleEventsWithoutLanguage: Array<{
			id: string;
			timestamp: string;
			type: string;
			filePath?: string;
			userPrompt?: string;
			language?: string;
			potentialLanguageFromFilePath?: string;
			potentialLanguageFromPrompt?: string;
		}>;
		detectionIssues: {
			eventsWithFilePathButNoLanguage: number;
			eventsWithPromptButNoLanguage: number;
			eventsWithNeitherFilePathNorPrompt: number;
		};
	}> {
		const allEvents = await this.getAllEvents();
		const eventsWithLanguage = allEvents.filter(e => e.language && e.language !== 'unknown');
		const eventsWithoutLanguage = allEvents.filter(e => !e.language || e.language === 'unknown');
		
		const languageDistribution: Record<string, number> = {};
		allEvents.forEach(event => {
			const lang = event.language || 'unknown';
			languageDistribution[lang] = (languageDistribution[lang] || 0) + 1;
		});
		
		// Analyze detection issues
		let eventsWithFilePathButNoLanguage = 0;
		let eventsWithPromptButNoLanguage = 0;
		let eventsWithNeitherFilePathNorPrompt = 0;
		
		const sampleEventsWithoutLanguage = eventsWithoutLanguage.slice(0, 10).map(event => {
			// Try to detect what language this should have been
			let potentialLanguageFromFilePath: string | undefined;
			let potentialLanguageFromPrompt: string | undefined;
			
			if (event.filePath) {
				potentialLanguageFromFilePath = this.detectLanguageFromFilePath(event.filePath);
				if (!potentialLanguageFromFilePath) {
					eventsWithFilePathButNoLanguage++;
				}
			}
			
			if (event.userPrompt) {
				potentialLanguageFromPrompt = this.detectLanguageFromPromptContent(event.userPrompt);
				if (!potentialLanguageFromPrompt) {
					eventsWithPromptButNoLanguage++;
				}
			}
			
			if (!event.filePath && !event.userPrompt) {
				eventsWithNeitherFilePathNorPrompt++;
			}
			
			return {
				id: event.id,
				timestamp: event.timestamp,
				type: event.type,
				filePath: event.filePath,
				userPrompt: event.userPrompt ? event.userPrompt.substring(0, 150) + '...' : undefined,
				language: event.language,
				potentialLanguageFromFilePath,
				potentialLanguageFromPrompt
			};
		});
		
		return {
			totalEvents: allEvents.length,
			eventsWithLanguage: eventsWithLanguage.length,
			eventsWithoutLanguage: eventsWithoutLanguage.length,
			languageDistribution,
			sampleEventsWithoutLanguage,
			detectionIssues: {
				eventsWithFilePathButNoLanguage,
				eventsWithPromptButNoLanguage,
				eventsWithNeitherFilePathNorPrompt
			}
		};
	}

	/**
	 * Helper method to detect language from file path
	 */
	private detectLanguageFromFilePath(filePath: string): string | undefined {
		if (!filePath) {
			return undefined;
		}
		
		const ext = filePath.split('.').pop()?.toLowerCase();
		if (!ext) {
			return undefined;
		}
		
		const languageMap: Record<string, string> = {
			'ts': 'typescript',
			'tsx': 'typescript',
			'js': 'javascript',
			'jsx': 'javascript',
			'mjs': 'javascript',
			'py': 'python',
			'pyw': 'python',
			'java': 'java',
			'cs': 'csharp',
			'cpp': 'cpp',
			'cxx': 'cpp',
			'cc': 'cpp',
			'c': 'c',
			'h': 'c',
			'hpp': 'cpp',
			'go': 'go',
			'rs': 'rust',
			'php': 'php',
			'rb': 'ruby',
			'swift': 'swift',
			'kt': 'kotlin',
			'scala': 'scala',
			'sql': 'sql',
			'html': 'html',
			'htm': 'html',
			'css': 'css',
			'scss': 'scss',
			'sass': 'scss',
			'json': 'json',
			'xml': 'xml',
			'md': 'markdown',
			'yml': 'yaml',
			'yaml': 'yaml',
			'sh': 'bash',
			'bash': 'bash',
			'zsh': 'bash',
			'ps1': 'powershell',
			'vue': 'vue',
			'svelte': 'svelte'
		};
		
		return languageMap[ext];
	}

	/**
	 * Helper method to detect language from prompt content
	 */
	private detectLanguageFromPromptContent(prompt: string): string | undefined {
		if (!prompt) {
			return undefined;
		}
		
		const text = prompt.toLowerCase();
		
		// Look for language-specific keywords or patterns
		const languagePatterns: Record<string, RegExp[]> = {
			'typescript': [/\btypescript\b/, /\b\.ts\b/, /\binterface\b/, /\btype\s+\w+\s*=/, /\bas\s+\w+/],
			'javascript': [/\bjavascript\b/, /\b\.js\b/, /\bconst\s+\w+\s*=/, /\bfunction\s*\(/, /\b=>\s*/],
			'python': [/\bpython\b/, /\b\.py\b/, /\bdef\s+\w+\s*\(/, /\bimport\s+\w+/, /\bfrom\s+\w+\s+import/],
			'java': [/\bjava\b/, /\b\.java\b/, /\bpublic\s+class/, /\bpublic\s+static\s+void\s+main/],
			'csharp': [/\bc#\b/, /\bcsharp\b/, /\b\.cs\b/, /\bpublic\s+class/, /\busing\s+System/],
			'go': [/\bgolang\b/, /\b\.go\b/, /\bfunc\s+\w+\s*\(/, /\bpackage\s+main/],
			'rust': [/\brust\b/, /\b\.rs\b/, /\bfn\s+\w+\s*\(/, /\blet\s+mut/],
			'sql': [/\bsql\b/, /\bselect\s+/, /\bfrom\s+\w+/, /\bwhere\s+/, /\binsert\s+into/],
			'html': [/\bhtml\b/, /\b<\/?\w+/, /\b\.html\b/],
			'css': [/\bcss\b/, /\b\.css\b/, /\{\s*\w+\s*:/, /\bcolor\s*:/],
			'markdown': [/\bmarkdown\b/, /\b\.md\b/, /\b#+\s/, /\[.*\]\(.*\)/]
		};
		
		for (const [language, patterns] of Object.entries(languagePatterns)) {
			if (patterns.some(pattern => pattern.test(text))) {
				return language;
			}
		}
		
		return undefined;
	}
}
