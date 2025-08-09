/**
 * Analytics and statistical calculation interfaces
 * Based on the architecture document specifications
 */

export interface AnalyticsQuery {
    dateRange: DateRange;
    eventTypes?: string[];
    languages?: string[];
    models?: string[];
    sessionIds?: string[];
}

export interface DateRange {
    start: Date;
    end: Date;
}

export interface AggregatedMetrics {
    totalEvents: number;
    uniqueSessions: number;
    averageEventsPerSession: number;
    totalDuration: number;
    averageDuration: number;
    totalTokensUsed: number;
    averageTokensPerEvent: number;
}

export interface TimeSeriesDataPoint {
    timestamp: string;             // ISO8601 or date string
    value: number;
    metadata?: Record<string, any>;
}

export interface LanguageUsageMetric {
    language: string;
    eventCount: number;
    percentage: number;
    averageDuration?: number;
    totalTokens?: number;
}

export interface ModelUsageMetric {
    model: string;
    eventCount: number;
    percentage: number;
    averageDuration?: number;
    totalTokens?: number;
    successRate?: number;
}

export interface EventTypeDistribution {
    type: string;
    count: number;
    percentage: number;
}

export interface SessionAnalytics {
    sessionId: string;
    startTime: string;
    endTime?: string;
    duration: number;              // Total session duration in ms
    eventCount: number;
    uniqueLanguages: string[];
    uniqueModels: string[];
    workspaceId?: string;
}

export interface HourlyDistribution {
    hour: number;                  // 0-23
    eventCount: number;
    percentage: number;
}

export interface DayOfWeekDistribution {
    dayOfWeek: number;            // 0-6 (Sunday to Saturday)
    dayName: string;
    eventCount: number;
    percentage: number;
}

export interface AnalyticsResult {
    query: AnalyticsQuery;
    aggregatedMetrics: AggregatedMetrics;
    timeSeriesData: TimeSeriesDataPoint[];
    languageMetrics: LanguageUsageMetric[];
    modelMetrics: ModelUsageMetric[];
    eventTypeDistribution: EventTypeDistribution[];
    hourlyDistribution: HourlyDistribution[];
    dayOfWeekDistribution: DayOfWeekDistribution[];
    sessionAnalytics: SessionAnalytics[];
    generatedAt: string;          // ISO8601 timestamp
}

export interface ExportOptions {
    format: 'json' | 'csv' | 'xlsx';
    includeRawEvents: boolean;
    includeAnalytics: boolean;
    dateRange?: DateRange;
    anonymizeData: boolean;
}

export interface ExportResult {
    filePath: string;
    format: string;
    eventCount: number;
    fileSize: number;            // In bytes
    exportedAt: string;          // ISO8601 timestamp
}

// Chart.js specific interfaces for data visualization
export interface ChartDataset {
    label: string;
    data: number[];
    borderColor?: string;
    backgroundColor?: string;
    tension?: number;
    fill?: boolean;
}

export interface ChartConfiguration {
    type: 'line' | 'bar' | 'doughnut' | 'pie';
    labels: string[];
    datasets: ChartDataset[];
    options?: Record<string, any>;
}

export interface DashboardWidgetData {
    totalEvents: number;
    eventsToday: number;
    eventsThisWeek: number;
    eventsThisMonth: number;
    averageSessionDuration: string;  // Formatted duration
    topLanguage: string;
    topModel: string;
    lastEventTime?: string;          // Formatted time
}

// Performance monitoring interfaces
export interface PerformanceMetrics {
    memoryUsage: number;           // MB
    processingTime: number;        // ms
    eventsProcessed: number;
    errorCount: number;
    lastUpdate: string;            // ISO8601 timestamp
}

export interface ProcessingStatistics {
    batchSize: number;
    processingTimeMs: number;
    eventsAdded: number;
    duplicatesSkipped: number;
    errorsEncountered: number;
}
