/**
 * Simplified Copilot Usage History Panel using unified session data
 * Session-based data only - no log parsing
 */

import * as vscode from 'vscode';
import { UsageStorageManager } from '../../storage/usage-storage-manager';
import { AnalyticsEngine } from '../../storage/analytics-engine';
import { CopilotUsageEvent, DateRange } from '../../types/usage-events';
import { AnalyticsQuery, DashboardWidgetData } from '../../types/analytics';
import { ILogger } from '../../types/logger';

export class CopilotUsageHistoryPanel implements vscode.WebviewViewProvider {
	public static readonly viewType = 'copilot-usage-history-panel';

	private webviewView?: vscode.WebviewView;
	private storageManager: UsageStorageManager;
	private updateTimer?: NodeJS.Timeout;
	private sessionEventsCallback?: (events: CopilotUsageEvent[]) => Promise<void>;
	private logEntriesCallback?: (logEntries: any[]) => Promise<void>;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly context: vscode.ExtensionContext,
		private readonly logger: ILogger
	) {
		this.storageManager = new UsageStorageManager(context, logger);

		// Initialize storage asynchronously and register callbacks after initialization
		this.initializeAsync();
	}

	private async initializeAsync() {
		try {
			// Initialize storage first
			await this.storageManager.initialize();

			// Subscribe to real-time session events updates
			this.sessionEventsCallback = async (events) => {
				this.logger.info(`REAL-TIME SESSION UPDATE: Received ${events.length} session events`);
				await this.updateWebviewContent();
				this.logger.info('REAL-TIME SESSION UPDATE: Webview updated');
			};
			this.storageManager.onSessionEventsUpdated(this.sessionEventsCallback);

			// Subscribe to real-time log entries updates (for immediate feedback)
			this.logEntriesCallback = async (logEntries) => {
				this.logger.info(`REAL-TIME LOG UPDATE: Received ${logEntries.length} log entries`);
				// Log entries are real-time, don't need to update webview for every entry
				// But we could show a live indicator or update counters
			};
			this.storageManager.onLogEntriesUpdated(this.logEntriesCallback);
		} catch (error) {
			this.logger.error(`Failed to initialize storage: ${error}`);
		}

		// Set up auto-refresh
		// Set up auto-refresh
		this.setupAutoRefresh();
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this.webviewView = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri]
		};

		// Load initial content
		this.updateWebviewContent();

		// Handle messages from webview
		webviewView.webview.onDidReceiveMessage(async data => await this.onDidReceiveMessage(data));

		// Clean up when webview is disposed
		webviewView.onDidDispose(() => {
			if (this.updateTimer) {
				clearInterval(this.updateTimer);
			}
		});
	}

	private async onDidReceiveMessage(data: any) {
		this.logger.trace(`Webview message received: ${JSON.stringify(data)}`);

		// Also try showing a popup to confirm message reception
		vscode.window.showInformationMessage(`Webview message received: ${data.type}`);

		switch (data.type) {
			case 'refresh':
				await this.refreshData();
				break;
			case 'scanHistoricalLogs':
				await this.scanChatSessions();
				break;
			case 'scanChatSessions':
				await this.scanChatSessions();
				break;
			case 'exportData':
				await this.exportData(data.options);
				break;
			case 'updateTimeRange':
				await this.updateTimeRange(data.timeRange);
				break;
			case 'clearData':
				this.logger.trace('Processing clearData request');
				await this.clearData();
				break;
			case 'updateSettings':
				await this.updateSettings(data.settings);
				break;
			case 'testCcreqProvider':
				await this.testCcreqProvider(data.ccreqUri);
				break;
			default:
				this.logger.warn(`Unknown message type: ${data.type}`);
		}
	}

	/**
     * Refresh data and update webview
     */
	private async refreshData(): Promise<void> {
		await this.updateWebviewContent();
		this.logger.info('Copilot usage data refreshed');
	}

	/**
     * Scan chat sessions for usage events (primary method)
     */
	private async scanChatSessions(): Promise<void> {
		try {
			this.logger.info('Starting chat session scan...');

			// Show progress in webview
			await this.postMessage({
				type: 'scanProgress',
				status: 'scanning',
				message: 'Discovering chat session files...'
			});

			const { events, stats } = await this.storageManager.scanChatSessions();

			await this.postMessage({
				type: 'scanProgress',
				status: 'processing',
				message: `Processing ${events.length} events from ${stats.totalSessions} sessions...`
			});

			if (events.length > 0) {
				this.logger.info(`Session scan complete: ${events.length} events from ${stats.totalSessions} sessions processed in ${stats.scanDuration}ms`);
				vscode.window.showInformationMessage(
					`Processed ${events.length} Copilot usage events from ${stats.totalSessions} chat sessions`
				);
			} else {
				this.logger.info('No chat sessions found');
				vscode.window.showInformationMessage('No Copilot chat sessions found');
			}

			await this.postMessage({
				type: 'scanProgress',
				status: 'complete',
				eventsFound: events.length,
				sessionsFound: stats.totalSessions,
				scanDuration: stats.scanDuration
			});

			// Refresh the webview with new data
			await this.updateWebviewContent();

		} catch (error) {
			this.logger.error(`Chat session scan failed: ${error}`);
			vscode.window.showErrorMessage(`Failed to scan chat sessions: ${error}`);

			await this.postMessage({
				type: 'scanProgress',
				status: 'error',
				error: String(error)
			});
		}
	}

	/**
     * Export usage data
     */
	private async exportData(options: any): Promise<void> {
		try {
			const settings = await this.storageManager.getSettings();
			const dateRange = this.getDateRangeForTimespan(settings.defaultTimeRange);
			const events = await this.storageManager.getEventsForDateRange(dateRange);

			// Create export data
			const exportData = {
				metadata: {
					exportedAt: new Date().toISOString(),
					totalEvents: events.length,
					dateRange: {
						start: dateRange.start.toISOString(),
						end: dateRange.end.toISOString()
					}
				},
				events: options.includeRawEvents ? events : [],
				analytics: options.includeAnalytics ? this.calculateAnalytics(events, dateRange) : null
			};

			// Save to file
			const exportPath = await vscode.window.showSaveDialog({
				defaultUri: vscode.Uri.file(`copilot-usage-export-${new Date().toISOString().split('T')[0]}.json`),
				filters: {
					'JSON files': ['json'],
					'All files': ['*']
				}
			});

			if (exportPath) {
				await vscode.workspace.fs.writeFile(exportPath, Buffer.from(JSON.stringify(exportData, null, 2), 'utf8'));
				vscode.window.showInformationMessage(`Usage data exported to ${exportPath.fsPath}`);
			}

		} catch (error) {
			vscode.window.showErrorMessage(`Failed to export data: ${error}`);
		}
	}

	/**
     * Update time range setting
     */
	private async updateTimeRange(timeRange: '7d' | '30d' | '90d'): Promise<void> {
		await this.storageManager.updateSettings({ defaultTimeRange: timeRange });
		await this.updateWebviewContent();
	}

	/**
     * Clear all usage data
     */
	private async clearData(): Promise<void> {
		this.logger.trace('Starting clearData method');

		// Show confirmation dialog using VS Code's native modal
		const confirmation = await vscode.window.showWarningMessage(
			'Are you sure you want to clear all Copilot usage data? This action cannot be undone.',
			{ modal: true },
			'Clear Data'
		);

		this.logger.trace(`User confirmation result: ${confirmation}`);

		if (confirmation === 'Clear Data') {
			try {
				this.logger.trace('Calling storageManager.clearStorage()');
				const result = await this.storageManager.clearStorage();
				this.logger.info(`Storage cleared successfully: ${JSON.stringify(result)}`);

				// Show success notification
				vscode.window.showInformationMessage(`✅ Usage data cleared: ${result.deletedFiles} files, ${result.deletedEvents} events`);

				await this.updateWebviewContent();
			} catch (error) {
				this.logger.error(`Error clearing storage: ${error}`);
				vscode.window.showErrorMessage(`Failed to clear data: ${error}`);
			}
		} else {
			this.logger.trace('User cancelled operation');
		}
	}

	/**
     * Update settings
     */
	private async updateSettings(settings: any): Promise<void> {
		await this.storageManager.updateSettings(settings);
		await this.updateWebviewContent();
	}

	/**
     * Test ccreq file provider by attempting to open a ccreq URI
     */
	private async testCcreqProvider(ccreqUri: string): Promise<void> {
		try {
			this.logger.trace(`Testing ccreq provider with URI: ${ccreqUri}`);

			// Parse and validate the URI
			const uri = vscode.Uri.parse(ccreqUri);
			this.logger.trace(`Parsed URI - scheme: ${uri.scheme}, path: ${uri.path}`);

			if (uri.scheme !== 'ccreq') {
				throw new Error(`Invalid scheme: expected 'ccreq', got '${uri.scheme}'`);
			}

			// Attempt to read the document content
			const startTime = Date.now();
			const document = await vscode.workspace.openTextDocument(uri);
			const loadTime = Date.now() - startTime;

			const content = document.getText();
			const contentLength = content.length;
			const lineCount = document.lineCount;

			this.logger.info(`SUCCESS - Document loaded in ${loadTime}ms`);
			this.logger.trace(`Content length: ${contentLength} characters`);
			this.logger.trace(`Line count: ${lineCount}`);
			this.logger.trace(`First 200 chars: ${content.substring(0, 200)}...`);

			// Open the document in markdown preview mode
			await vscode.commands.executeCommand('markdown.showPreviewToSide', document.uri);

			this.logger.info('Document opened in markdown preview');

			// Send results to webview
			await this.postMessage({
				type: 'ccreqTestResult',
				success: true,
				uri: ccreqUri,
				loadTime,
				contentLength,
				lineCount,
				preview: content.substring(0, 500),
				openedInEditor: true
			});

			// Also show in VS Code
			vscode.window.showInformationMessage(`✅ ccreq provider test successful! Loaded ${contentLength} chars in ${loadTime}ms and opened in editor`);

		} catch (error) {
			this.logger.error(`ERROR: ${error}`);

			// Send error to webview
			await this.postMessage({
				type: 'ccreqTestResult',
				success: false,
				uri: ccreqUri,
				error: String(error)
			});

			// Also show in VS Code
			vscode.window.showErrorMessage(`❌ ccreq provider test failed: ${error}`);
		}
	}

	/**
     * Clear all storage data (public method for command interface)
     */
	public async clearStorage(): Promise<void> {
		const result = await this.storageManager.clearStorage();
		this.logger.info(`Storage cleared: ${result.deletedFiles} files, ${result.deletedEvents} events`);
		await this.updateWebviewContent();
	}

	/**
     * Update webview content with current data
     */
	private async updateWebviewContent(): Promise<void> {
		if (!this.webviewView) {
			return;
		}

		try {
			const settings = await this.storageManager.getSettings();
			const dateRange = this.getDateRangeForTimespan(settings.defaultTimeRange);
			const events = await this.storageManager.getEventsForDateRange(dateRange);

			this.logger.trace(`Found ${events.length} events for date range ${dateRange.start.toISOString()} to ${dateRange.end.toISOString()}`);

			const dashboardData = AnalyticsEngine.calculateQuickStats(events);
			const analytics = this.calculateAnalytics(events, dateRange);
			const storageStats = await this.storageManager.getStorageStats();

			this.logger.trace(`Dashboard data: ${JSON.stringify(dashboardData)}`);
			this.logger.trace(`Analytics data keys: ${Object.keys(analytics)}`);

			this.webviewView.webview.html = this.getWebviewContent(dashboardData, analytics, storageStats, settings);

		} catch (error) {
			this.logger.error(`Failed to update webview content: ${error}`);
			this.webviewView.webview.html = this.getErrorWebviewContent(String(error));
		}
	}

	/**
     * Calculate analytics for given events and date range
     */
	private calculateAnalytics(events: CopilotUsageEvent[], dateRange: DateRange): any {
		const query: AnalyticsQuery = { dateRange };
		return AnalyticsEngine.calculateAnalytics(events, query);
	}

	/**
     * Get date range for a given timespan
     */
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
     * Set up automatic refresh of data
     */
	private setupAutoRefresh(): void {
		this.updateTimer = setInterval(async () => {
			if (this.webviewView && this.webviewView.visible) {
				await this.updateWebviewContent();
			}
		}, 30000); // Refresh every 30 seconds when visible
	}

	/**
     * Post message to webview
     */
	private async postMessage(message: any): Promise<void> {
		if (this.webviewView) {
			await this.webviewView.webview.postMessage(message);
		}
	}

	/**
     * Generate the HTML content for the webview
     */
	private getWebviewContent(
		dashboardData: DashboardWidgetData,
		analytics: any,
		storageStats: any,
		settings: any
	): string {
		if (!this.webviewView) {
			return 'Webview not available';
		}

		const chartJsUri = this.webviewView.webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'node_modules', 'chart.js', 'dist', 'chart.umd.min.js')
		);

		return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src vscode-resource: 'unsafe-inline';">
            <title>Copilot Usage History</title>
            <script src="${chartJsUri}"></script>
            <style>
                ${this.getWebviewStyles()}
            </style>
        </head>
        <body>
            <div class="usage-dashboard">
                <header class="dashboard-header">
                    <h1>Copilot Usage History</h1>
                    <div class="controls">
                        <select id="timeRange" onchange="updateTimeRange(this.value)">
                            <option value="7d" ${settings.defaultTimeRange === '7d' ? 'selected' : ''}>Last 7 Days</option>
                            <option value="30d" ${settings.defaultTimeRange === '30d' ? 'selected' : ''}>Last 30 Days</option>
                            <option value="90d" ${settings.defaultTimeRange === '90d' ? 'selected' : ''}>Last 90 Days</option>
                        </select>
                        <button id="refreshBtn">Refresh</button>
                        <button id="scanSessionsBtn">Scan Sessions</button>
                        <button id="scanHistoryBtn">Scan Sessions</button>
                        <button id="exportBtn">Export</button>
                        <button id="clearStorageBtn" class="warning-button" title="Clear all stored usage data">Clear Storage</button>
                    </div>
                </header>
                
                <section class="summary-cards">
                    <div class="card">
                        <h3>Total Events</h3>
                        <span class="metric">${dashboardData.totalEvents}</span>
                    </div>
                    <div class="card">
                        <h3>Today</h3>
                        <span class="metric">${dashboardData.eventsToday}</span>
                    </div>
                    <div class="card">
                        <h3>This Week</h3>
                        <span class="metric">${dashboardData.eventsThisWeek}</span>
                    </div>
                    <div class="card">
                        <h3>This Month</h3>
                        <span class="metric">${dashboardData.eventsThisMonth}</span>
                    </div>
                </section>

                <section class="chart-section">
                    <h3>Usage Over Time</h3>
                    <div class="chart-container">
                        <canvas id="timeSeriesChart" width="400" height="200"></canvas>
                    </div>
                </section>

                <section class="chart-section">
                    <h3>Event Types</h3>
                    <div class="chart-container">
                        <canvas id="eventTypeChart" width="400" height="150"></canvas>
                    </div>
                </section>

                <section class="chart-section">
                    <h3>Languages</h3>
                    <div class="chart-container">
                        <canvas id="languageChart" width="400" height="150"></canvas>
                    </div>
                </section>

                <section class="analytics-section">
                    <div class="analytics-grid">
                        <div class="analytics-card">
                            <h4>Top Languages</h4>
                            <div class="list">
                                ${analytics.languageMetrics.slice(0, 5).map((lang: any) =>
									`<div class="list-item">
                                        <span>${lang.language}</span>
                                        <span>${lang.eventCount}</span>
                                    </div>`
								).join('')}
                            </div>
                        </div>
                        
                        <div class="analytics-card">
                            <h4>Top Models</h4>
                            <div class="list">
                                ${analytics.modelMetrics.slice(0, 5).map((model: any) =>
									`<div class="list-item">
                                        <span>${model.model}</span>
                                        <span>${model.eventCount}</span>
                                    </div>`
								).join('')}
                            </div>
                        </div>
                    </div>
                </section>

                <section class="storage-info">
                    <h4>Storage Information</h4>
                    <div class="storage-stats">
                        <span>Total Files: ${storageStats.totalFiles}</span>
                        <span>Storage Size: ${Math.round(storageStats.totalSizeBytes / 1024)} KB</span>
                        ${storageStats.oldestEvent ? `<span>Oldest Event: ${new Date(storageStats.oldestEvent).toLocaleDateString()}</span>` : ''}
                        ${storageStats.newestEvent ? `<span>Newest Event: ${new Date(storageStats.newestEvent).toLocaleDateString()}</span>` : ''}
                    </div>
                </section>

                <section class="ccreq-debug">
                    <h4>🔍 ccreq File Provider Debug</h4>
                    <div class="ccreq-debug-content">
                        <div class="ccreq-input-section">
                            <label for="ccreqInput">ccreq URI:</label>
                            <input 
                                type="text" 
                                id="ccreqInput" 
                                placeholder="ccreq:95e746dc.copilotmd"
                                value="ccreq:95e746dc.copilotmd"
                            />
                            <button id="testCcreqBtn">Test Provider</button>
                        </div>
                        <div id="ccreqResults" class="ccreq-results" style="display: none;">
                            <div id="ccreqResultContent"></div>
                        </div>
                    </div>
                </section>

                <div id="scanProgress" class="scan-progress" style="display: none;">
                    <div class="progress-content">
                        <div class="spinner"></div>
                        <span id="scanMessage">Scanning...</span>
                    </div>
                </div>
            </div>

            <script>
                ${this.getWebviewScript(analytics)}
            </script>
        </body>
        </html>`;
	}

	/**
     * Generate CSS styles for the webview
     */
	private getWebviewStyles(): string {
		return `
            body {
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
                color: var(--vscode-foreground);
                background-color: var(--vscode-sideBar-background);
                margin: 0;
                padding: 12px;
                line-height: 1.4;
            }
            
            .usage-dashboard {
                max-width: 100%;
            }
            
            .dashboard-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 16px;
                flex-wrap: wrap;
                gap: 8px;
            }
            
            .dashboard-header h1 {
                margin: 0;
                font-size: 16px;
                font-weight: 600;
                color: var(--vscode-sideBarTitle-foreground);
            }
            
            .controls {
                display: flex;
                gap: 4px;
                flex-wrap: wrap;
            }
            
            .controls select,
            .controls button {
                padding: 2px 6px;
                font-size: 11px;
                border: 1px solid var(--vscode-widget-border);
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border-radius: 2px;
                cursor: pointer;
            }
            
            .controls select {
                background-color: var(--vscode-dropdown-background);
                color: var(--vscode-dropdown-foreground);
            }
            
            .controls button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
            
            .warning-button {
                background-color: var(--vscode-errorForeground) !important;
                color: var(--vscode-foreground) !important;
                border-color: var(--vscode-errorForeground) !important;
            }
            
            .warning-button:hover {
                background-color: var(--vscode-errorForeground) !important;
                opacity: 0.8;
            }
            
            .summary-cards {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
                gap: 8px;
                margin-bottom: 16px;
            }
            
            .card {
                background-color: var(--vscode-sideBarSectionHeader-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
                padding: 8px;
                text-align: center;
            }
            
            .card h3 {
                margin: 0 0 4px 0;
                font-size: 10px;
                font-weight: 600;
                color: var(--vscode-descriptionForeground);
                text-transform: uppercase;
            }
            
            .metric {
                font-size: 18px;
                font-weight: bold;
                color: var(--vscode-button-background);
            }
            
            .chart-section {
                margin-bottom: 16px;
            }
            
            .chart-section h3 {
                margin: 0 0 8px 0;
                font-size: 12px;
                font-weight: 600;
                color: var(--vscode-sideBarTitle-foreground);
            }
            
            .chart-container {
                background-color: var(--vscode-editor-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
                padding: 8px;
                height: 150px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .analytics-section {
                margin-bottom: 16px;
            }
            
            .analytics-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
            }
            
            .analytics-card {
                background-color: var(--vscode-sideBarSectionHeader-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
                padding: 8px;
            }
            
            .analytics-card h4 {
                margin: 0 0 8px 0;
                font-size: 11px;
                font-weight: 600;
                color: var(--vscode-sideBarTitle-foreground);
            }
            
            .list {
                font-size: 10px;
            }
            
            .list-item {
                display: flex;
                justify-content: space-between;
                padding: 2px 0;
                border-bottom: 1px solid var(--vscode-panel-border);
            }
            
            .list-item:last-child {
                border-bottom: none;
            }
            
            .storage-info {
                margin-bottom: 16px;
            }
            
            .storage-info h4 {
                margin: 0 0 8px 0;
                font-size: 11px;
                font-weight: 600;
                color: var(--vscode-sideBarTitle-foreground);
            }
            
            .storage-stats {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                font-size: 10px;
                color: var(--vscode-descriptionForeground);
            }
            
            .storage-stats span {
                background-color: var(--vscode-badge-background);
                color: var(--vscode-badge-foreground);
                padding: 2px 4px;
                border-radius: 2px;
            }
            
            .ccreq-debug {
                margin-bottom: 16px;
                background-color: var(--vscode-sideBarSectionHeader-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
                padding: 12px;
            }
            
            .ccreq-debug h4 {
                margin: 0 0 12px 0;
                font-size: 12px;
                font-weight: 600;
                color: var(--vscode-sideBarTitle-foreground);
            }
            
            .ccreq-input-section {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 12px;
                flex-wrap: wrap;
            }
            
            .ccreq-input-section label {
                font-size: 11px;
                font-weight: 600;
                color: var(--vscode-foreground);
                min-width: 60px;
            }
            
            .ccreq-input-section input {
                flex: 1;
                min-width: 200px;
                padding: 4px 8px;
                font-size: 11px;
                font-family: var(--vscode-editor-font-family);
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border);
                border-radius: 2px;
            }
            
            .ccreq-input-section input:focus {
                outline: none;
                border-color: var(--vscode-focusBorder);
            }
            
            .ccreq-results {
                background-color: var(--vscode-editor-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
                padding: 8px;
                font-family: var(--vscode-editor-font-family);
                font-size: 10px;
                max-height: 200px;
                overflow-y: auto;
            }
            
            .ccreq-result-success {
                color: var(--vscode-terminal-ansiGreen);
            }
            
            .ccreq-result-error {
                color: var(--vscode-errorForeground);
            }
            
            .ccreq-result-info {
                color: var(--vscode-descriptionForeground);
                margin: 4px 0;
            }
            
            .ccreq-result-preview {
                background-color: var(--vscode-textCodeBlock-background);
                border: 1px solid var(--vscode-textBlockQuote-border);
                border-radius: 2px;
                padding: 8px;
                margin: 8px 0;
                white-space: pre-wrap;
                font-family: var(--vscode-editor-font-family);
                font-size: 9px;
                max-height: 100px;
                overflow-y: auto;
            }
            
            .scan-progress {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background-color: var(--vscode-sideBar-background);
                border: 2px solid var(--vscode-button-background);
                border-radius: 4px;
                padding: 16px;
                text-align: center;
                z-index: 1000;
            }
            
            .progress-content {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .spinner {
                width: 16px;
                height: 16px;
                border: 2px solid var(--vscode-panel-border);
                border-top: 2px solid var(--vscode-button-background);
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
	}

	/**
     * Generate JavaScript for the webview
     */
	private getWebviewScript(analytics: any): string {
		// Pre-serialize analytics data safely to avoid injection issues
		const safeAnalyticsData = {
			timeSeriesData: analytics.timeSeriesData || [],
			eventTypeDistribution: analytics.eventTypeDistribution || [],
			languageMetrics: analytics.languageMetrics || []
		};

		return `
            const vscode = acquireVsCodeApi();
            
            // Safely inject analytics data
            const analyticsData = ${JSON.stringify(safeAnalyticsData)};
            
            // Make vscode object globally available for debugging
            window.vscodeMcp = vscode;
            window.testMessage = function() {
                console.log('testMessage called');
                vscode.postMessage({ type: 'clearData' });
            };
            
            function refreshData() {
                vscode.postMessage({ type: 'refresh' });
            }
            
            function scanHistoricalLogs() {
                document.getElementById('scanProgress').style.display = 'block';
                vscode.postMessage({ type: 'scanHistoricalLogs' });
            }
            
            function scanChatSessions() {
                document.getElementById('scanProgress').style.display = 'block';
                vscode.postMessage({ type: 'scanChatSessions' });
            }
            
            function exportData() {
                vscode.postMessage({ 
                    type: 'exportData',
                    options: {
                        includeRawEvents: true,
                        includeAnalytics: true
                    }
                });
            }
            
            function testNotifications() {
                console.log('Test notifications button clicked');
                vscode.postMessage({ type: 'testNotifications' });
            }
            
            function testCcreqProvider() {
                console.log('Test ccreq provider button clicked');
                const ccreqInput = document.getElementById('ccreqInput');
                const ccreqUri = ccreqInput.value.trim();
                
                if (!ccreqUri) {
                    showCcreqResult(false, 'Please enter a ccreq URI', null);
                    return;
                }
                
                // Show loading state
                showCcreqResult(null, 'Testing ccreq provider...', null);
                
                // Send message to extension
                vscode.postMessage({ 
                    type: 'testCcreqProvider',
                    ccreqUri: ccreqUri
                });
            }
            
            function showCcreqResult(success, message, data) {
                const resultsEl = document.getElementById('ccreqResults');
                const contentEl = document.getElementById('ccreqResultContent');
                
                resultsEl.style.display = 'block';
                
                if (success === null) {
                    // Loading state
                    contentEl.innerHTML = \`
                        <div class="ccreq-result-info">⏳ \${message}</div>
                    \`;
                } else if (success) {
                    // Success
                    const editorInfo = data.openedInEditor ? '<div class="ccreq-result-info">📄 Content opened in VS Code editor</div>' : '';
                    contentEl.innerHTML = \`
                        <div class="ccreq-result-success">✅ \${message}</div>
                        <div class="ccreq-result-info">Load time: \${data.loadTime}ms</div>
                        <div class="ccreq-result-info">Content length: \${data.contentLength} characters</div>
                        <div class="ccreq-result-info">Line count: \${data.lineCount}</div>
                        \${editorInfo}
                        <div class="ccreq-result-preview">\${data.preview}</div>
                    \`;
                } else {
                    // Error
                    contentEl.innerHTML = \`
                        <div class="ccreq-result-error">❌ \${message}</div>
                    \`;
                }
            }
            
            function clearStorage() {
                console.log('Clear storage button clicked');
                
                // Send clearData message - confirmation will be handled by VS Code extension
                console.log('Sending clearData message to extension');
                vscode.postMessage({ type: 'clearData' });
            }
            
            function updateTimeRange(timeRange) {
                vscode.postMessage({ type: 'updateTimeRange', timeRange });
            }
            
            // Set up event listeners for buttons (to avoid CSP issues with inline onclick)
            // Use immediate execution instead of DOMContentLoaded for VS Code webviews
            console.log('Setting up event listeners immediately');
            
            let eventListenersSetup = false; // Prevent duplicate setup
            
            function setupEventListeners() {
                if (eventListenersSetup) {
                    console.log('Event listeners already set up, skipping');
                    return;
                }
                
                console.log('setupEventListeners called');
                
                const refreshBtn = document.getElementById('refreshBtn');
                if (refreshBtn) {
                    refreshBtn.addEventListener('click', refreshData);
                    console.log('Refresh button event listener added');
                } else {
                    console.log('ERROR: refreshBtn not found');
                }
                
                const scanHistoryBtn = document.getElementById('scanHistoryBtn');
                if (scanHistoryBtn) {
                    scanHistoryBtn.addEventListener('click', scanHistoricalLogs);
                    console.log('Scan history button event listener added');
                } else {
                    console.log('ERROR: scanHistoryBtn not found');
                }
                
                const scanSessionsBtn = document.getElementById('scanSessionsBtn');
                if (scanSessionsBtn) {
                    scanSessionsBtn.addEventListener('click', scanChatSessions);
                    console.log('Scan sessions button event listener added');
                } else {
                    console.log('ERROR: scanSessionsBtn not found');
                }
                
                const exportBtn = document.getElementById('exportBtn');
                if (exportBtn) {
                    exportBtn.addEventListener('click', exportData);
                    console.log('Export button event listener added');
                } else {
                    console.log('ERROR: exportBtn not found');
                }
                
                const clearStorageBtn = document.getElementById('clearStorageBtn');
                if (clearStorageBtn) {
                    clearStorageBtn.addEventListener('click', function() {
                        console.log('Clear storage button CLICKED via event listener!');
                        clearStorage();
                    });
                    console.log('Clear storage button event listener added');
                } else {
                    console.log('ERROR: clearStorageBtn not found');
                }
                
                const testBtn = document.getElementById('testBtn');
                if (testBtn) {
                    testBtn.addEventListener('click', function() {
                        console.log('TEST BUTTON WORKS!');
                    });
                    console.log('Test button event listener added');
                } else {
                    console.log('ERROR: testBtn not found');
                }
                
                const testNotificationsBtn = document.getElementById('testNotificationsBtn');
                if (testNotificationsBtn) {
                    testNotificationsBtn.addEventListener('click', testNotifications);
                    console.log('Test notifications button event listener added');
                } else {
                    console.log('ERROR: testNotificationsBtn not found');
                }
                
                const testCcreqBtn = document.getElementById('testCcreqBtn');
                if (testCcreqBtn) {
                    testCcreqBtn.addEventListener('click', testCcreqProvider);
                    console.log('Test ccreq button event listener added');
                } else {
                    console.log('ERROR: testCcreqBtn not found');
                }
                
                const retryBtn = document.getElementById('retryBtn');
                if (retryBtn) {
                    retryBtn.addEventListener('click', function() { location.reload(); });
                    console.log('Retry button event listener added');
                } else {
                    console.log('ERROR: retryBtn not found (this is normal for main view)');
                }
                
                // List all buttons found
                const allButtons = document.querySelectorAll('button');
                console.log(\`Total buttons found: \${allButtons.length}\`);
                allButtons.forEach((btn, index) => {
                    console.log(\`Button \${index}: id='\${btn.id}', text='\${btn.textContent}'\`);
                });
                
                eventListenersSetup = true;
                console.log('Event listeners setup completed');
            }
            
            // Try multiple approaches to ensure setup runs, but only once
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', setupEventListeners);
            } else {
                setupEventListeners();
            }
            
            // Handle messages from extension
            window.addEventListener('message', event => {
                const message = event.data;
                
                switch (message.type) {
                    case 'scanProgress':
                        handleScanProgress(message);
                        break;
                    case 'ccreqTestResult':
                        handleCcreqTestResult(message);
                        break;
                }
            });
            
            function handleScanProgress(message) {
                const progressEl = document.getElementById('scanProgress');
                const messageEl = document.getElementById('scanMessage');
                
                switch (message.status) {
                    case 'scanning':
                        messageEl.textContent = message.message || 'Scanning...';
                        break;
                    case 'processing':
                        messageEl.textContent = message.message || 'Processing...';
                        break;
                    case 'complete':
                        messageEl.textContent = \`Complete: \${message.eventsFound} events found\`;
                        setTimeout(() => {
                            progressEl.style.display = 'none';
                        }, 2000);
                        break;
                    case 'error':
                        messageEl.textContent = \`Error: \${message.error}\`;
                        setTimeout(() => {
                            progressEl.style.display = 'none';
                        }, 3000);
                        break;
                }
            }
            
            function handleCcreqTestResult(message) {
                console.log('Received ccreq test result:', message);
                
                if (message.success) {
                    const openedText = message.openedInEditor ? ' (Opened in editor)' : '';
                    showCcreqResult(true, 'ccreq provider test successful!' + openedText, message);
                } else {
                    showCcreqResult(false, message.error || 'Unknown error', null);
                }
            }
            
            // Chart.js rendering implementation
            let timeSeriesChart = null;
            let eventTypeChart = null;
            let languageChart = null;
            
            function renderTimeSeriesChart() {
                try {
                    console.log('Rendering time series chart...');
                    const canvas = document.getElementById('timeSeriesChart');
                    if (!canvas || !window.Chart) {
                        console.log('Canvas or Chart.js not available for time series');
                        return;
                    }
                    
                    // Destroy existing chart
                    if (timeSeriesChart) {
                        timeSeriesChart.destroy();
                    }
                    
                    const ctx = canvas.getContext('2d');
                    const data = analyticsData.timeSeriesData;
                    console.log('Time series data:', data);
                    
                    if (data.length === 0) {
                        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--vscode-descriptionForeground');
                        ctx.fillText('No data available', 10, 100);
                        return;
                    }
                    
                    // Prepare Chart.js data
                    const chartData = {
                        labels: data.map(d => d.timestamp),
                        datasets: [{
                            label: 'Daily Events',
                            data: data.map(d => d.value),
                            borderColor: getComputedStyle(document.body).getPropertyValue('--vscode-button-background'),
                            backgroundColor: getComputedStyle(document.body).getPropertyValue('--vscode-button-background') + '20',
                            tension: 0.1,
                            fill: true
                        }]
                    };
                    
                    timeSeriesChart = new Chart(ctx, {
                        type: 'line',
                        data: chartData,
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: {
                                    display: false
                                }
                            },
                            scales: {
                                x: {
                                    display: true,
                                    grid: {
                                        color: getComputedStyle(document.body).getPropertyValue('--vscode-panel-border')
                                    },
                                    ticks: {
                                        color: getComputedStyle(document.body).getPropertyValue('--vscode-foreground')
                                    }
                                },
                                y: {
                                    display: true,
                                    grid: {
                                        color: getComputedStyle(document.body).getPropertyValue('--vscode-panel-border')
                                    },
                                    ticks: {
                                        color: getComputedStyle(document.body).getPropertyValue('--vscode-foreground')
                                    }
                                }
                            }
                        }
                    });
                    
                    console.log('Time series chart rendered successfully');
                } catch (error) {
                    console.error('Error rendering time series chart:', error);
                }
            }
            
            function renderEventTypeChart() {
                try {
                    const canvas = document.getElementById('eventTypeChart');
                    if (!canvas || !window.Chart) {
                        console.log('Canvas or Chart.js not available for event type chart');
                        return;
                    }
                    
                    // Destroy existing chart
                    if (eventTypeChart) {
                        eventTypeChart.destroy();
                    }
                    
                    const ctx = canvas.getContext('2d');
                    const data = analyticsData.eventTypeDistribution;
                    
                    if (data.length === 0) {
                        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--vscode-descriptionForeground');
                        ctx.fillText('No data available', 10, 50);
                        return;
                    }
                    
                    const chartData = {
                        labels: data.map(d => d.type),
                        datasets: [{
                            data: data.map(d => d.count),
                            backgroundColor: [
                                getComputedStyle(document.body).getPropertyValue('--vscode-button-background'),
                                getComputedStyle(document.body).getPropertyValue('--vscode-button-secondaryBackground'),
                                getComputedStyle(document.body).getPropertyValue('--vscode-charts-green'),
                                getComputedStyle(document.body).getPropertyValue('--vscode-charts-orange'),
                                getComputedStyle(document.body).getPropertyValue('--vscode-charts-blue')
                            ]
                        }]
                    };
                    
                    eventTypeChart = new Chart(ctx, {
                        type: 'doughnut',
                        data: chartData,
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: {
                                    position: 'bottom',
                                    labels: {
                                        color: getComputedStyle(document.body).getPropertyValue('--vscode-foreground'),
                                        font: {
                                            size: 10
                                        }
                                    }
                                }
                            }
                        }
                    });
                    
                    console.log('Event type chart rendered successfully');
                } catch (error) {
                    console.error('Error rendering event type chart:', error);
                }
            }
            
            function renderLanguageChart() {
                try {
                    const canvas = document.getElementById('languageChart');
                    if (!canvas || !window.Chart) {
                        console.log('Canvas or Chart.js not available for language chart');
                        return;
                    }
                    
                    // Destroy existing chart
                    if (languageChart) {
                        languageChart.destroy();
                    }
                    
                    const ctx = canvas.getContext('2d');
                    const data = analyticsData.languageMetrics;
                    
                    if (data.length === 0) {
                        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--vscode-descriptionForeground');
                        ctx.fillText('No data available', 10, 50);
                        return;
                    }
                    
                    const chartData = {
                        labels: data.map(d => d.language),
                        datasets: [{
                            data: data.map(d => d.eventCount),
                            backgroundColor: data.map((_, i) => {
                                const colors = [
                                    '--vscode-button-background',
                                    '--vscode-charts-green',
                                    '--vscode-charts-blue',
                                    '--vscode-charts-orange',
                                    '--vscode-charts-red'
                                ];
                                return getComputedStyle(document.body).getPropertyValue(colors[i % colors.length]);
                            })
                        }]
                    };
                    
                    languageChart = new Chart(ctx, {
                        type: 'bar',
                        data: chartData,
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: {
                                    display: false
                                }
                            },
                            scales: {
                                x: {
                                    display: true,
                                    grid: {
                                        color: getComputedStyle(document.body).getPropertyValue('--vscode-panel-border')
                                    },
                                    ticks: {
                                        color: getComputedStyle(document.body).getPropertyValue('--vscode-foreground')
                                    }
                                },
                                y: {
                                    display: true,
                                    grid: {
                                        color: getComputedStyle(document.body).getPropertyValue('--vscode-panel-border')
                                    },
                                    ticks: {
                                        color: getComputedStyle(document.body).getPropertyValue('--vscode-foreground')
                                    }
                                }
                            }
                        }
                    });
                    
                    console.log('Language chart rendered successfully');
                } catch (error) {
                    console.error('Error rendering language chart:', error);
                }
            }
            
            // Initialize charts when DOM is loaded
            function initializeCharts() {
                console.log('Initializing charts...');
                
                if (typeof window.Chart !== 'undefined') {
                    console.log('Chart.js is available, rendering charts');
                    renderTimeSeriesChart();
                    renderEventTypeChart();
                    renderLanguageChart();
                } else {
                    console.warn('Chart.js not available, retrying in 100ms...');
                    setTimeout(initializeCharts, 100);
                }
            }
            
            // Wait for DOM and Chart.js to be ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    setTimeout(initializeCharts, 50);
                });
            } else {
                setTimeout(initializeCharts, 50);
            }
        `;
	}

	/**
     * Generate error content for the webview
     */
	private getErrorWebviewContent(error: string): string {
		return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-sideBar-background);
                    margin: 20px;
                }
                .error {
                    color: var(--vscode-errorForeground);
                    background-color: var(--vscode-inputValidation-errorBackground);
                    padding: 12px;
                    border-radius: 4px;
                    border: 1px solid var(--vscode-inputValidation-errorBorder);
                }
            </style>
        </head>
        <body>
            <h3>Error Loading Usage History</h3>
            <div class="error">
                ${error}
            </div>
            <button id="retryBtn">Retry</button>
        </body>
        </html>`;
	}

	dispose(): void {
		if (this.updateTimer) {
			clearInterval(this.updateTimer);
		}

		// Remove event callbacks to prevent memory leaks
		if (this.sessionEventsCallback) {
			this.storageManager.removeSessionEventCallback(this.sessionEventsCallback);
		}
		if (this.logEntriesCallback) {
			this.storageManager.removeLogEventCallback(this.logEntriesCallback);
		}

		// Dispose storage manager resources
		this.storageManager.dispose();
	}
}
