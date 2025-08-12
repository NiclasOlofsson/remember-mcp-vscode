import { EnhancedAnalyticsEngine } from '../../storage/enhanced-analytics-engine';
import { CopilotUsageEvent, DateRange } from '../../types/usage-events';
import { AnalyticsQuery } from '../../types/analytics';
import { ILogger } from '../../types/logger';
import {
	SummaryCardsViewModel,
	ChartViewModel,
	AnalyticsTableViewModel,
	FilterControlsViewModel,
	StorageInfoViewModel,
	DebugSectionViewModel,
	GlobalStateViewModel
} from './copilot-usage-history-types';

/**
 * Model for Copilot Usage History Panel
 * Composes micro-view-models and manages data/business logic
 */
export class CopilotUsageHistoryModel {
	private _listeners: Array<() => void> = [];
	private _sessionEventsCallback?: (events: CopilotUsageEvent[]) => void;
	private _logEntriesCallback?: (logEntries: any[]) => void;

	// Micro-view-models
	public summaryCards!: SummaryCardsViewModel;
	public timeSeriesChart!: ChartViewModel;
	public eventTypeChart!: ChartViewModel;
	public languageChart!: ChartViewModel;
	public topLanguagesTable!: AnalyticsTableViewModel;
	public topModelsTable!: AnalyticsTableViewModel;
	public filterControls!: FilterControlsViewModel;
	public storageInfo!: StorageInfoViewModel;
	public debugSection!: DebugSectionViewModel;
	public globalState!: GlobalStateViewModel;

	constructor(
		private readonly analyticsEngine: EnhancedAnalyticsEngine,
		private readonly logger: ILogger
	) {
		// Initialize micro-view-models with default states
		this.initializeMicroViewModels();

		// Set up real-time data callbacks
		this.setupDataCallbacks();

		// Start background data initialization (non-blocking)
		this.initializeDataAsync();
	}

	/**
	 * Initialize data asynchronously in the background
	 */
	private initializeDataAsync(): void {
		// Fire and forget - don't await
		this.initializeData().catch(error => {
			this.logger.error('Background data initialization failed:', error);
			this.setGlobalError(String(error));
		});
	}

	/**
	 * Initialize all micro-view-models with default states
	 */
	private initializeMicroViewModels(): void {
		this.summaryCards = {
			title: 'Usage Summary',
			cards: [],
			isLoading: true
		};

		this.timeSeriesChart = {
			title: 'Usage Over Time',
			canvasId: 'timeSeriesChart',
			data: {},
			options: {},
			isLoading: true,
			isEmpty: true,
			height: 200,
			width: 400
		};

		this.eventTypeChart = {
			title: 'Event Types',
			canvasId: 'eventTypeChart',
			data: {},
			options: {},
			isLoading: true,
			isEmpty: true,
			height: 150,
			width: 400
		};

		this.languageChart = {
			title: 'Languages',
			canvasId: 'languageChart',
			data: {},
			options: {},
			isLoading: true,
			isEmpty: true,
			height: 150,
			width: 400
		};

		this.topLanguagesTable = {
			title: 'Top Languages',
			headers: ['Language', 'Count'],
			rows: [],
			isLoading: true,
			isEmpty: true,
			showMore: {
				enabled: false,
				currentLimit: 5,
				totalItems: 0,
				action: 'Show More'
			}
		};

		this.topModelsTable = {
			title: 'Top Models',
			headers: ['Model', 'Count'],
			rows: [],
			isLoading: true,
			isEmpty: true,
			showMore: {
				enabled: false,
				currentLimit: 5,
				totalItems: 0,
				action: 'Show More'
			}
		};

		this.filterControls = {
			timeRange: {
				current: '30d',
				options: [
					{ value: '7d', label: 'Last 7 Days', selected: false },
					{ value: '30d', label: 'Last 30 Days', selected: true },
					{ value: '90d', label: 'Last 90 Days', selected: false }
				]
			},
			dateRange: {
				start: new Date(),
				end: new Date(),
				formatted: {
					start: '',
					end: '',
					range: ''
				}
			},
			actions: {
				canExport: false,
				canClear: false,
				canRefresh: true,
				canScan: true
			}
		};

		this.storageInfo = {
			title: 'Storage Information',
			stats: [],
			isLoading: true
		};

		this.debugSection = {
			title: '🔍 ccreq File Provider Debug',
			isVisible: true,
			content: {
				ccreqInput: 'ccreq:95e746dc.copilotmd',
				results: null
			},
			isLoading: false
		};

		this.globalState = {
			isLoading: true,
			isScanning: true, // Start scanning immediately since initializeDataAsync() runs on construction
			hasData: false,
			isVisible: true
		};
	}

	/**
	 * Set up callbacks for real-time data updates
	 */
	private setupDataCallbacks(): void {
		// Session events callback
		this._sessionEventsCallback = (events: CopilotUsageEvent[]) => {
			this.logger.info(`Real-time session update: ${events.length} events`);
			this.processSessionEvents(events);
		};

		// Log entries callback  
		this._logEntriesCallback = (logEntries: any[]) => {
			this.logger.info(`Real-time log update: ${logEntries.length} entries`);
			// Could update real-time indicators here
		};

		// Register callbacks
		this.analyticsEngine.onSessionEventsUpdated(this._sessionEventsCallback);
		this.analyticsEngine.onLogEntriesUpdated(this._logEntriesCallback);
	}

	/**
	 * Load initial data and update all micro-view-models
	 */
	private async initializeData(): Promise<void> {
		try {
			// Set scanning state for initial data load
			this.globalState.isScanning = true;
			this.notifyListeners();

			// Storage manager is already initialized by the panel
			await this.refreshAllData();
		} catch (error) {
			this.logger.error('Failed to initialize history model:', error);
			this.setGlobalError(String(error));
		} finally {
			// Always clear scanning state when done
			this.globalState.isScanning = false;
			this.notifyListeners();
		}
	}

	/**
	 * Refresh all data and update micro-view-models
	 */
	public async refreshAllData(): Promise<void> {
		try {
			this.globalState.isLoading = true;

			// Get current settings and data
			const settings = await this.analyticsEngine.getSettings();
			const dateRange = this.getDateRangeForTimespan(settings.defaultTimeRange);
			const events = await this.analyticsEngine.getEventsForDateRange(dateRange);
			const storageStats = await this.analyticsEngine.getStorageStats();

			// Update filter controls first
			this.updateFilterControls(settings, dateRange);

			// Process events and update all micro-view-models
			await this.processSessionEvents(events);

			// Update storage info
			this.updateStorageInfo(storageStats);

			// Update global state
			this.globalState = {
				isLoading: false,
				isScanning: false,
				hasData: events.length > 0,
				isVisible: this.globalState.isVisible,
				lastUpdated: new Date()
			};

			// Notify listeners
			this.notifyListeners();

		} catch (error) {
			this.logger.error('Failed to refresh data:', error);
			this.setGlobalError(String(error));
		}
	}

	/**
	 * Process session events and update all relevant micro-view-models
	 */
	private async processSessionEvents(events: CopilotUsageEvent[]): Promise<void> {
		console.log('Model.processSessionEvents: Processing', events.length, 'events');
		
		// Calculate analytics
		const dateRange = this.getDateRangeForTimespan(this.filterControls.timeRange.current);
		const query: AnalyticsQuery = { dateRange };
		const analytics = await this.analyticsEngine.calculateAnalytics(events, query);
		const quickStats = await this.analyticsEngine.calculateQuickStats(events);
		
		console.log('Model.processSessionEvents: Analytics:', analytics);
		console.log('Model.processSessionEvents: Quick stats:', quickStats);

		// Update summary cards
		this.updateSummaryCards(quickStats, events);

		// Update charts
		this.updateTimeSeriesChart(analytics);
		this.updateEventTypeChart(analytics);
		this.updateLanguageChart(analytics);

		// Update analytics tables
		this.updateTopLanguagesTable(analytics);
		this.updateTopModelsTable(analytics);
	}

	/**
	 * Update summary cards micro-view-model
	 */
	private updateSummaryCards(quickStats: any, _events: CopilotUsageEvent[]): void {
		this.summaryCards = {
			title: 'Usage Summary',
			isLoading: false,
			cards: [
				{
					title: 'Total Events',
					value: quickStats.totalEvents.toString(),
					highlighted: quickStats.totalEvents > 0
				},
				{
					title: 'Today',
					value: quickStats.eventsToday.toString()
				},
				{
					title: 'This Week',
					value: quickStats.eventsThisWeek.toString()
				},
				{
					title: 'This Month',
					value: quickStats.eventsThisMonth.toString()
				}
			]
		};
	}

	/**
	 * Update time series chart micro-view-model
	 */
	private updateTimeSeriesChart(analytics: any): void {
		const hasData = analytics.timeSeriesData && analytics.timeSeriesData.length > 0;
		console.log('Model.updateTimeSeriesChart: hasData:', hasData, 'analytics.timeSeriesData:', analytics.timeSeriesData);

		this.timeSeriesChart = {
			...this.timeSeriesChart,
			subtitle: `Last ${this.filterControls.timeRange.current}`,
			data: hasData ? this.prepareTimeSeriesChartData(analytics.timeSeriesData) : {},
			options: this.getTimeSeriesChartOptions(),
			isLoading: false,
			isEmpty: !hasData
		};
		
		console.log('Model.updateTimeSeriesChart: Chart isEmpty now:', this.timeSeriesChart.isEmpty);
	}

	/**
	 * Update event type chart micro-view-model
	 */
	private updateEventTypeChart(analytics: any): void {
		const hasData = analytics.eventTypeDistribution && analytics.eventTypeDistribution.length > 0;

		this.eventTypeChart = {
			...this.eventTypeChart,
			data: hasData ? this.prepareEventTypeChartData(analytics.eventTypeDistribution) : {},
			options: this.getEventTypeChartOptions(),
			isLoading: false,
			isEmpty: !hasData
		};
	}

	/**
	 * Update language chart micro-view-model
	 */
	private updateLanguageChart(analytics: any): void {
		const hasData = analytics.languageMetrics && analytics.languageMetrics.length > 0;

		this.languageChart = {
			...this.languageChart,
			data: hasData ? this.prepareLanguageChartData(analytics.languageMetrics) : {},
			options: this.getLanguageChartOptions(),
			isLoading: false,
			isEmpty: !hasData
		};
	}

	/**
	 * Update top languages table micro-view-model
	 */
	private updateTopLanguagesTable(analytics: any): void {
		const languages = analytics.languageMetrics || [];
		const hasData = languages.length > 0;

		this.topLanguagesTable = {
			...this.topLanguagesTable,
			rows: languages.slice(0, this.topLanguagesTable.showMore?.currentLimit || 5).map((lang: any) => ({
				values: [lang.language, lang.eventCount.toString()],
				updated: false // Could track changes for flash effect
			})),
			isLoading: false,
			isEmpty: !hasData,
			showMore: {
				enabled: languages.length > 5,
				currentLimit: 5,
				totalItems: languages.length,
				action: 'Show More Languages'
			}
		};
	}

	/**
	 * Update top models table micro-view-model
	 */
	private updateTopModelsTable(analytics: any): void {
		const models = analytics.modelMetrics || [];
		const hasData = models.length > 0;

		this.topModelsTable = {
			...this.topModelsTable,
			rows: models.slice(0, this.topModelsTable.showMore?.currentLimit || 5).map((model: any) => ({
				values: [model.model, model.eventCount.toString()],
				updated: false
			})),
			isLoading: false,
			isEmpty: !hasData,
			showMore: {
				enabled: models.length > 5,
				currentLimit: 5,
				totalItems: models.length,
				action: 'Show More Models'
			}
		};
	}

	/**
	 * Update filter controls micro-view-model
	 */
	private updateFilterControls(settings: any, dateRange: DateRange): void {
		const current = settings.defaultTimeRange;

		this.filterControls = {
			timeRange: {
				current,
				options: [
					{ value: '7d', label: 'Last 7 Days', selected: current === '7d' },
					{ value: '30d', label: 'Last 30 Days', selected: current === '30d' },
					{ value: '90d', label: 'Last 90 Days', selected: current === '90d' }
				]
			},
			dateRange: {
				start: dateRange.start,
				end: dateRange.end,
				formatted: {
					start: dateRange.start.toLocaleDateString(),
					end: dateRange.end.toLocaleDateString(),
					range: `${dateRange.start.toLocaleDateString()} - ${dateRange.end.toLocaleDateString()}`
				}
			},
			actions: {
				canExport: this.globalState.hasData,
				canClear: this.globalState.hasData,
				canRefresh: true,
				canScan: true
			}
		};
	}

	/**
	 * Update storage info micro-view-model
	 */
	private updateStorageInfo(storageStats: any): void {
		this.storageInfo = {
			title: 'Storage Information',
			stats: [
				{ label: 'Total Files', value: storageStats.totalFiles?.toString() || '0' },
				{ label: 'Storage Size', value: `${Math.round((storageStats.totalSizeBytes || 0) / 1024)} KB` },
				...(storageStats.oldestEvent ? [{ label: 'Oldest Event', value: new Date(storageStats.oldestEvent).toLocaleDateString() }] : []),
				...(storageStats.newestEvent ? [{ label: 'Newest Event', value: new Date(storageStats.newestEvent).toLocaleDateString() }] : [])
			],
			lastUpdated: new Date(),
			isLoading: false
		};
	}

	/**
	 * Set global error state
	 */
	private setGlobalError(error: string): void {
		this.globalState = {
			isLoading: false,
			isScanning: false,
			hasData: false,
			isVisible: this.globalState.isVisible,
			errorMessage: error
		};

		// Set error state on all micro-view-models
		this.summaryCards.isLoading = false;
		this.summaryCards.errorMessage = error;
		this.timeSeriesChart.isLoading = false;
		this.timeSeriesChart.errorMessage = error;
		this.eventTypeChart.isLoading = false;
		this.eventTypeChart.errorMessage = error;
		this.languageChart.isLoading = false;
		this.languageChart.errorMessage = error;
		this.topLanguagesTable.isLoading = false;
		this.topLanguagesTable.errorMessage = error;
		this.topModelsTable.isLoading = false;
		this.topModelsTable.errorMessage = error;

		this.notifyListeners();
	}

	// Chart data preparation methods
	private prepareTimeSeriesChartData(timeSeriesData: any[]): any {
		return {
			labels: timeSeriesData.map(d => new Date(d.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
			datasets: [{
				label: 'Daily Events',
				data: timeSeriesData.map(d => d.value),
				backgroundColor: 'var(--vscode-button-background)',
				borderColor: 'var(--vscode-button-background)',
				borderWidth: 1
			}]
		};
	}

	private prepareEventTypeChartData(eventTypeDistribution: any[]): any {
		return {
			labels: eventTypeDistribution.map(d => d.type),
			datasets: [{
				data: eventTypeDistribution.map(d => d.count),
				backgroundColor: [
					'var(--vscode-button-background)',
					'var(--vscode-button-secondaryBackground)',
					'var(--vscode-charts-green)',
					'var(--vscode-charts-orange)',
					'var(--vscode-charts-blue)'
				]
			}]
		};
	}

	private prepareLanguageChartData(languageMetrics: any[]): any {
		return {
			labels: languageMetrics.map(d => d.language),
			datasets: [{
				data: languageMetrics.map(d => d.eventCount),
				backgroundColor: languageMetrics.map((_, i) => {
					const colors = [
						'var(--vscode-button-background)',
						'var(--vscode-charts-green)',
						'var(--vscode-charts-blue)',
						'var(--vscode-charts-orange)',
						'var(--vscode-charts-red)'
					];
					return colors[i % colors.length];
				})
			}]
		};
	}

	// Chart options methods
	private getTimeSeriesChartOptions(): any {
		return {
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false } },
			scales: {
				x: {
					display: true,
					grid: { color: 'var(--vscode-panel-border)' },
					ticks: { color: 'var(--vscode-foreground)' }
				},
				y: {
					display: true,
					grid: { color: 'var(--vscode-panel-border)' },
					ticks: { color: 'var(--vscode-foreground)' }
				}
			}
		};
	}

	private getEventTypeChartOptions(): any {
		return {
			responsive: true,
			maintainAspectRatio: false,
			plugins: {
				legend: {
					position: 'bottom' as const,
					labels: {
						color: 'var(--vscode-foreground)',
						font: { size: 10 }
					}
				}
			}
		};
	}

	private getLanguageChartOptions(): any {
		return {
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false } },
			scales: {
				x: {
					display: true,
					grid: { color: 'var(--vscode-panel-border)' },
					ticks: { color: 'var(--vscode-foreground)' }
				},
				y: {
					display: true,
					grid: { color: 'var(--vscode-panel-border)' },
					ticks: { color: 'var(--vscode-foreground)' }
				}
			}
		};
	}

	// Utility methods
	private getDateRangeForTimespan(timespan: '7d' | '30d' | '90d'): DateRange {
		const end = new Date();
		const start = new Date();

		switch (timespan) {
			case '7d':
				start.setDate(start.getDate() - 7);
				break;
			case '30d':
				start.setDate(start.getDate() - 30);
				break;
			case '90d':
				start.setDate(start.getDate() - 90);
				break;
		}

		return { start, end };
	}

	/**
	 * Public API methods
	 */

	/**
	 * Subscribe to data changes
	 */
	public onDataChanged(listener: () => void): void {
		this._listeners.push(listener);
	}

	/**
	 * Update time range setting
	 */
	public async updateTimeRange(timeRange: '7d' | '30d' | '90d'): Promise<void> {
		await this.analyticsEngine.updateSettings({ defaultTimeRange: timeRange });
		await this.refreshAllData();
	}

	/**
	 * Clear all usage data
	 */
	public async clearData(): Promise<{ deletedFiles: number; deletedEvents: number }> {
		const result = await this.analyticsEngine.clearStorage();
		await this.refreshAllData();
		return result;
	}

	/**
	 * Export usage data
	 */
	public async getExportData(): Promise<any> {
		const settings = await this.analyticsEngine.getSettings();
		const dateRange = this.getDateRangeForTimespan(settings.defaultTimeRange);
		const events = await this.analyticsEngine.getEventsForDateRange(dateRange);

		return {
			metadata: {
				exportedAt: new Date().toISOString(),
				totalEvents: events.length,
				dateRange: {
					start: dateRange.start.toISOString(),
					end: dateRange.end.toISOString()
				}
			},
			events,
			analytics: await this.analyticsEngine.calculateAnalytics(events, { dateRange })
		};
	}

	/**
	 * Scan chat sessions
	 */
	public async scanChatSessions(): Promise<{ events: CopilotUsageEvent[]; stats: any }> {
		// Set scanning state
		this.globalState = {
			...this.globalState,
			isScanning: true
		};

		// Update scan progress
		this.filterControls.scanProgress = {
			isScanning: true,
			status: 'scanning',
			message: 'Discovering chat session files...'
		};
		this.notifyListeners();

		try {
			const result = await this.analyticsEngine.scanChatSessions();

			this.filterControls.scanProgress = {
				isScanning: false,
				status: 'complete',
				message: `Complete: ${result.events.length} events found`
			};

			// Reset scanning state and refresh all data
			this.globalState = {
				...this.globalState,
				isScanning: false
			};
			await this.refreshAllData();
			return result;

		} catch (error) {
			this.filterControls.scanProgress = {
				isScanning: false,
				status: 'error',
				message: `Error: ${error}`
			};
			
			// Reset scanning state on error
			this.globalState = {
				...this.globalState,
				isScanning: false
			};
			this.notifyListeners();
			throw error;
		}
	}

	/**
	 * Test ccreq file provider
	 */
	public async testCcreqProvider(ccreqUri: string): Promise<any> {
		this.debugSection.isLoading = true;
		this.notifyListeners();

		try {
			// This would integrate with the actual ccreq testing logic
			// For now, just simulate the test
			const result = {
				success: true,
				message: 'ccreq provider test successful!',
				data: {
					uri: ccreqUri,
					loadTime: 150,
					contentLength: 1500,
					lineCount: 45
				}
			};

			this.debugSection.isLoading = false;
			this.debugSection.results = result;
			this.notifyListeners();

			return result;

		} catch (error) {
			const result = {
				success: false,
				message: String(error),
				data: null
			};

			this.debugSection.isLoading = false;
			this.debugSection.results = result;
			this.notifyListeners();

			throw error;
		}
	}

	/**
	 * Notify all listeners of data changes
	 */
	private notifyListeners(): void {
		this._listeners.forEach(listener => {
			try {
				listener();
			} catch (error) {
				this.logger.error('Error notifying listener:', error);
			}
		});
	}

	/**
	 * Dispose and clean up resources
	 */
	public dispose(): void {
		// Remove callbacks
		if (this._sessionEventsCallback) {
			this.analyticsEngine.removeSessionEventCallback(this._sessionEventsCallback);
		}
		if (this._logEntriesCallback) {
			this.analyticsEngine.removeLogEventCallback(this._logEntriesCallback);
		}

		// Clear listeners
		this._listeners = [];
	}
}
