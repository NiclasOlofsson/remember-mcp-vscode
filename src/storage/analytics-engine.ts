/**
 * Analytics engine for calculating usage statistics and insights
 * Based on architecture document specifications
 */

import { CopilotUsageEvent, DateRange } from '../types/usage-events';
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

export class AnalyticsEngine {
	private static readonly DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

	/**
     * Calculate comprehensive analytics for given events and query
     */
	static calculateAnalytics(events: CopilotUsageEvent[], query: AnalyticsQuery): AnalyticsResult {
		// Filter events based on query
		const filteredEvents = this.filterEvents(events, query);
        
		return {
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
	}

	/**
     * Calculate quick dashboard statistics
     */
	static calculateQuickStats(events: CopilotUsageEvent[]): {
		totalEvents: number;
		eventsToday: number;
		eventsThisWeek: number;
		eventsThisMonth: number;
		averageSessionDuration: string;
		topLanguage: string;
		topModel: string;
		lastEventTime?: string;
	} {
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

		return {
			totalEvents: events.length,
			eventsToday,
			eventsThisWeek,
			eventsThisMonth,
			averageSessionDuration: this.formatDuration(avgDuration),
			topLanguage,
			topModel,
			lastEventTime
		};
	}

	/**
     * Filter events based on query criteria
     */
	private static filterEvents(events: CopilotUsageEvent[], query: AnalyticsQuery): CopilotUsageEvent[] {
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

	/**
     * Calculate aggregated metrics
     */
	private static calculateAggregatedMetrics(events: CopilotUsageEvent[]): AggregatedMetrics {
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

	/**
     * Calculate time series data for charts
     */
	private static calculateTimeSeriesData(events: CopilotUsageEvent[], dateRange: DateRange): TimeSeriesDataPoint[] {
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

	/**
     * Calculate language usage metrics
     */
	private static calculateLanguageMetrics(events: CopilotUsageEvent[]): LanguageUsageMetric[] {
		const languageCounts = new Map<string, { count: number; totalDuration: number; totalTokens: number }>();
        
		for (const event of events) {
			const language = event.language || 'unknown';
			const current = languageCounts.get(language) || { count: 0, totalDuration: 0, totalTokens: 0 };
            
			current.count++;
			current.totalDuration += event.duration || 0;
			current.totalTokens += event.tokensUsed || 0;
            
			languageCounts.set(language, current);
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

	/**
     * Calculate model usage metrics
     */
	private static calculateModelMetrics(events: CopilotUsageEvent[]): ModelUsageMetric[] {
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

	/**
     * Calculate event type distribution
     */
	private static calculateEventTypeDistribution(events: CopilotUsageEvent[]): EventTypeDistribution[] {
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

	/**
     * Calculate hourly distribution
     */
	private static calculateHourlyDistribution(events: CopilotUsageEvent[]): HourlyDistribution[] {
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

	/**
     * Calculate day of week distribution
     */
	private static calculateDayOfWeekDistribution(events: CopilotUsageEvent[]): DayOfWeekDistribution[] {
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
				dayName: this.DAY_NAMES[dayOfWeek],
				eventCount: count,
				percentage: totalEvents > 0 ? (count / totalEvents) * 100 : 0
			}))
			.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
	}

	/**
     * Calculate session analytics (with hierarchical session data)
     */
	private static calculateSessionAnalytics(events: CopilotUsageEvent[]): SessionAnalytics[] {
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

	/**
     * Calculate VS Code session analytics (process-level sessions)
     */
	private static calculateVSCodeSessionAnalytics(events: CopilotUsageEvent[]): VSCodeSessionAnalytics[] {
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

	/**
     * Calculate window session analytics
     */
	private static calculateWindowSessionAnalytics(events: CopilotUsageEvent[]): WindowSessionAnalytics[] {
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
     * Format duration in milliseconds to human readable string
     */
	private static formatDuration(durationMs: number): string {
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

	/**
     * Format relative time (e.g., "2 hours ago")
     */
	private static formatRelativeTime(date: Date): string {
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
}
