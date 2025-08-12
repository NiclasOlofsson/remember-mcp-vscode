/**
 * Type definitions for Copilot Usage History micro-view-models
 */

/**
 * Micro-view-model for summary cards section
 */
export interface SummaryCardsViewModel {
	title: string;
	cards: Array<{
		title: string;
		value: string;
		trend?: {
			direction: 'up' | 'down' | 'stable';
			percentage: number;
		};
		icon?: string;
		highlighted?: boolean;
	}>;
	isLoading: boolean;
	errorMessage?: string;
}

/**
 * Micro-view-model for chart components
 */
export interface ChartViewModel {
	title: string;
	subtitle?: string;
	data: any; // Chart.js compatible data structure
	options: any; // Chart.js options
	canvasId: string;
	isLoading: boolean;
	isEmpty: boolean;
	errorMessage?: string;
	height?: number;
	width?: number;
}

/**
 * Micro-view-model for analytics tables
 */
export interface AnalyticsTableViewModel {
	title: string;
	subtitle?: string;
	headers: string[];
	rows: Array<{
		values: string[];
		highlighted?: boolean;
		trend?: 'up' | 'down' | 'stable';
		updated?: boolean; // For flash animations
	}>;
	showMore?: {
		enabled: boolean;
		currentLimit: number;
		totalItems: number;
		action: string; // Button text
	};
	isLoading: boolean;
	isEmpty: boolean;
	errorMessage?: string;
}

/**
 * Micro-view-model for filter and control section
 */
export interface FilterControlsViewModel {
	timeRange: {
		current: '7d' | '30d' | '90d';
		options: Array<{ value: string; label: string; selected: boolean }>;
	};
	dateRange: {
		start: Date;
		end: Date;
		formatted: {
			start: string;
			end: string;
			range: string;
		};
	};
	actions: {
		canExport: boolean;
		canClear: boolean;
		canRefresh: boolean;
		canScan: boolean;
	};
	scanProgress?: {
		isScanning: boolean;
		status: 'scanning' | 'processing' | 'complete' | 'error';
		message: string;
		progress?: {
			current: number;
			total: number;
		};
	};
}

/**
 * Micro-view-model for storage information section
 */
export interface StorageInfoViewModel {
	title: string;
	stats: Array<{
		label: string;
		value: string;
		tooltip?: string;
	}>;
	lastUpdated?: Date;
	isLoading: boolean;
}

/**
 * Micro-view-model for debug sections (ccreq, etc.)
 */
export interface DebugSectionViewModel {
	title: string;
	isVisible: boolean;
	content: any; // Flexible content for different debug tools
	isLoading: boolean;
	results?: {
		success: boolean;
		message: string;
		data?: any;
	};
}

/**
 * Main view model state
 */
export interface GlobalStateViewModel {
	isLoading: boolean;
	isScanning: boolean;
	lastUpdated?: Date;
	errorMessage?: string;
	hasData: boolean;
	isVisible: boolean; // Webview visibility
}
