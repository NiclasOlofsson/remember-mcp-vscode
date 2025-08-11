/**
 * Comprehensive data model for Copilot usage events and analytics
 * Based on the architecture document specifications
 */

export interface CopilotUsageEvent {
	id: string;                    // Deterministic ID for deduplication
	timestamp: string;             // ISO8601 timestamp
	type: 'chat' | 'completion' | 'edit' | 'explain';
	source: 'copilot-chat' | 'copilot-inline' | 'copilot-sidebar';
    
	// Session Information (hierarchical)
	vscodeSessionId: string;       // VS Code process session (20250808T010909)
	windowId?: string;             // VS Code window identifier (window1, window2)
	extensionHostSessionId: string; // Extension host session (20250808T010916)
	sessionId: string;             // Composite session ID for backward compatibility
	workspaceId?: string;          // Workspace folder hash
    
	// Event Details
	duration?: number;             // Interaction duration (ms)
	tokensUsed?: number;           // Estimated token usage
	model?: string;                // AI model used
    
	// Context
	language?: string;             // Programming language
	filePath?: string;             // File being edited (anonymized)
	userPrompt?: string;           // User's input (if tracking enabled)
    
	// Metadata
	vsCodeVersion: string;
	copilotVersion: string;
	extensionVersion: string;
}

export interface UsageStatistics {
	totalEvents: number;
	eventsToday: number;
	eventsThisWeek: number;
	eventsThisMonth: number;
    
	topLanguages: Array<{language: string; count: number}>;
	averageSessionDuration: number;
	totalTokensUsed: number;
    
	dailyBreakdown: Array<{date: string; count: number}>;
	weeklyBreakdown: Array<{week: string; count: number}>;
	monthlyBreakdown: Array<{month: string; count: number}>;
}

export interface UsageStorageIndex {
	totalEvents: number;
	lastUpdate: string;           // ISO8601 timestamp
	eventFiles: string[];         // List of event data files
	settings: CopilotUsageSettings;
}

export interface CopilotUsageSettings {
	// Data Collection
	enableTracking: boolean;
	trackUserPrompts: boolean;
	retentionDays: number;
    
	// Performance
	maxEventsInMemory: number;
	batchSize: number;
	refreshIntervalMs: number;
    
	// UI
	defaultTimeRange: '7d' | '30d' | '90d';
	enableAnimations: boolean;
	chartTheme: 'auto' | 'light' | 'dark';
    
	// Storage
	storageLocation: 'global' | 'workspace';
	compressionEnabled: boolean;
	autoCleanup: boolean;
}

export interface DateRange {
	start: Date;
	end: Date;
}

export interface EventFile {
	date: string;               // YYYY-MM-DD
	filePath: string;
	eventCount: number;
}

export interface SessionInfo {
	sessionId: string;
	startTime: string;
	endTime?: string;
	eventCount: number;
	workspaceId?: string;
}

// Default settings
export const DEFAULT_USAGE_SETTINGS: CopilotUsageSettings = {
	// Data Collection
	enableTracking: true,
	trackUserPrompts: false,        // Privacy-conscious default
	retentionDays: 90,
    
	// Performance
	maxEventsInMemory: 10000,
	batchSize: 1000,
	refreshIntervalMs: 5000,
    
	// UI
	defaultTimeRange: '30d',
	enableAnimations: true,
	chartTheme: 'auto',
    
	// Storage
	storageLocation: 'global',
	compressionEnabled: false,      // Start simple
	autoCleanup: true
};
