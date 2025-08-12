import * as vscode from 'vscode';
import { CopilotUsageHistoryModel } from './copilot-usage-history-model';
import { WebviewUtils } from '../shared/webview-utils';
import { ILogger } from '../../types/logger';

/**
 * View for Copilot Usage History Panel
 * Consumes micro-view-models and handles HTML generation and toolbar visibility
 */
export class CopilotUsageHistoryView {
	constructor(
		private readonly _webview: vscode.Webview,
		private readonly _model: CopilotUsageHistoryModel,
		private readonly _extensionUri: vscode.Uri,
		private readonly _logger: ILogger
	) {
		// Set up data binding: model changes update the view
		this._model.onDataChanged(async () => {
			try {
				this._logger.trace('History model data changed, re-rendering view');
				await this.render();
			} catch (error) {
				this._logger.error('Error rendering CopilotUsageHistoryView:', error);
			}
		});
	}

	/**
	 * Generate and set the HTML content for the webview
	 */
	public async render(): Promise<void> {
		if (this._model.globalState.errorMessage) {
			this._webview.html = this.generateErrorHtml(this._model.globalState.errorMessage);
			// Error state: hide toolbar
			await this.updateToolbarVisibility(false);
			return;
		}

		const html = await this.generateHtml();
		this._webview.html = html;
		
		// Update toolbar visibility based on whether we have data
		const shouldShowToolbar = this._model.globalState.hasData;
		await this.updateToolbarVisibility(shouldShowToolbar);
	}

	/**
	 * Update toolbar visibility (view concern - view handles its own toolbar state)
	 */
	private async updateToolbarVisibility(shouldShowToolbar: boolean): Promise<void> {
		try {
			await vscode.commands.executeCommand('setContext', 'remember-mcp.hasUsageData', shouldShowToolbar);
			this._logger.trace(`View updated toolbar visibility: ${shouldShowToolbar}`);
		} catch (error) {
			this._logger.error('Error updating toolbar visibility:', error);
		}
	}

	/**
	 * Generate complete HTML content
	 */
	private async generateHtml(): Promise<string> {
		// Check if we have data - if not, show simple message like usage panel
		if (!this._model.globalState.hasData) {
			return this.generateSimpleNoDataHtml();
		}

		const chartJsUri = this.getChartJsUri();

		// Get analytics data from model for charts
		const analyticsData = {
			timeSeriesData: this.getTimeSeriesData(),
			eventTypeDistribution: this.getEventTypeData(),
			languageMetrics: this.getLanguageData()
		};

		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval' vscode-resource:; font-src 'self' data:;">
			<title>Copilot Usage History</title>
			<script src="${chartJsUri}"></script>
			${this.getWebviewStyles()}
		</head>
		<body>
			<div class="usage-dashboard">
				${this.generateDashboardHeader()}
				${this.generateSummaryCards()}
				${this.generateChartsSection()}
				${this.generateAnalyticsSection()}
				${this.generateStorageInfo()}
				${this.generateDebugSection()}
				${this.generateScanProgress()}
			</div>

			<script>
				${this.getWebviewScript(analyticsData)}
			</script>
		</body>
		</html>`;
	}

	/**
	 * Generate simple no data view with prominent call-to-action
	 */
	private generateSimpleNoDataHtml(): string {
		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval' vscode-resource:; font-src 'self' data:;">
			<title>Copilot Usage History</title>
			${this.getWebviewStyles()}
			<style>
				.empty-state {
					padding: 32px 24px;
					text-align: center;
					color: var(--vscode-foreground);
				}
				
				.empty-state h2 {
					font-size: 18px;
					font-weight: 600;
					margin: 0 0 8px 0;
					color: var(--vscode-foreground);
				}
				
				.empty-state .description {
					font-size: 13px;
					color: var(--vscode-descriptionForeground);
					margin-bottom: 24px;
					line-height: 1.4;
				}
				
				.cta-button {
					background-color: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border: none;
					border-radius: 2px;
					padding: 10px 16px;
					font-size: 13px;
					font-weight: 500;
					cursor: pointer;
					font-family: var(--vscode-font-family);
					margin-bottom: 16px;
					width: 200px;
					transition: background-color 0.2s ease;
				}
				
				.cta-button:hover {
					background-color: var(--vscode-button-hoverBackground);
				}
				
				.cta-button:focus {
					outline: 1px solid var(--vscode-focusBorder);
					outline-offset: 2px;
				}
				
				.cta-button:disabled {
					background-color: var(--vscode-button-secondaryBackground);
					color: var(--vscode-button-secondaryForeground);
					cursor: not-allowed;
					opacity: 0.6;
				}
				
				.cta-button:disabled:hover {
					background-color: var(--vscode-button-secondaryBackground);
				}
				
				.secondary-action {
					font-size: 12px;
					color: var(--vscode-descriptionForeground);
					margin-top: 16px;
				}
				
				.secondary-action a {
					color: var(--vscode-textLink-foreground);
					text-decoration: none;
				}
				
				.secondary-action a:hover {
					text-decoration: underline;
				}
			</style>
		</head>
		<body>
			<div class="empty-state">
				<h2>No Copilot Usage Data... Yet!</h2>
				<div class="description">
					Track and analyze your entire Copilot usage history! See all your coding sessions, 
					chat interactions, and productivity patterns. Press the button to get started with 
					scanning your chat sessions for usage events.
				</div>
				
				<button class="cta-button" id="scanButton" ${this._model.globalState.isScanning ? 'disabled' : ''}>
					${this._model.globalState.isScanning ? 'Scanning...' : 'Scan Chat Sessions'}
				</button>
			</div>
			
			${WebviewUtils.getSharedScript()}
			<script>
				// Add event listener instead of inline onclick
				document.addEventListener('DOMContentLoaded', function() {
					const scanButton = document.getElementById('scanButton');
					if (scanButton) {
						scanButton.addEventListener('click', function() {
							if (scanButton.disabled) {
								console.log('Button is disabled, ignoring click');
								return;
							}
							console.log('Button clicked');
							sendMessage('scanChatSessions');
						});
					}
				});
			</script>
		</body>
		</html>`;
	}

	/**
	 * Generate dashboard header with controls
	 */
	private generateDashboardHeader(): string {
		const { filterControls } = this._model;

		return `
			<div class="dashboard-header">
				<h1>Copilot Usage History</h1>
				<div class="controls">
					<select id="timeRange" onchange="updateTimeRange(this.value)">
						${filterControls.timeRange.options.map((option: any) =>
							`<option value="${option.value}" ${option.selected ? 'selected' : ''}>${option.label}</option>`
						).join('')}
					</select>
				</div>
			</div>
		`;
	}

	/**
	 * Generate summary cards section
	 */
	private generateSummaryCards(): string {
		const { summaryCards, globalState } = this._model;

		if (summaryCards.isLoading) {
			return '<div class="summary-cards">Loading...</div>';
		}

		if (!globalState.hasData) {
			return '<div class="summary-cards">No usage data available</div>';
		}

		return `
			<section class="summary-cards">
				${summaryCards.cards.map(card => `
					<div class="card">
						<h3>${WebviewUtils.escapeHtml(card.title)}</h3>
						<span class="metric">${WebviewUtils.escapeHtml(card.value)}</span>
					</div>
				`).join('')}
			</section>
		`;
	}

	/**
	 * Generate charts section
	 */
	private generateChartsSection(): string {
		if (!this._model.globalState.hasData) {
			return '<div class="chart-section">No data available for charts</div>';
		}

		return `
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
		`;
	}

	/**
	 * Generate analytics section with tables
	 */
	private generateAnalyticsSection(): string {
		const { topLanguagesTable, topModelsTable, globalState } = this._model;

		if (!globalState.hasData) {
			return '<div class="analytics-section">No data available for analytics</div>';
		}

		return `
			<section class="analytics-section">
				<div class="analytics-grid">
					<div class="analytics-card">
						<h4>Top Languages</h4>
						<div class="list">
							${topLanguagesTable.rows.slice(0, 5).map(row => `
								<div class="list-item">
									<span>${WebviewUtils.escapeHtml(row.values[0])}</span>
									<span>${WebviewUtils.escapeHtml(row.values[1])}</span>
								</div>
							`).join('')}
						</div>
					</div>

					<div class="analytics-card">
						<h4>Top Models</h4>
						<div class="list">
							${topModelsTable.rows.slice(0, 5).map(row => `
								<div class="list-item">
									<span>${WebviewUtils.escapeHtml(row.values[0])}</span>
									<span>${WebviewUtils.escapeHtml(row.values[1])}</span>
								</div>
							`).join('')}
						</div>
					</div>
				</div>
			</section>
		`;
	}

	/**
	 * Generate storage info section
	 */
	private generateStorageInfo(): string {
		const { storageInfo } = this._model;

		return `
			<section class="storage-info">
				<h4>${WebviewUtils.escapeHtml(storageInfo.title)}</h4>
				<div class="storage-stats">
					${storageInfo.stats.map((stat: any) => `
						<span title="${stat.tooltip || ''}">${stat.label}: ${stat.value}</span>
					`).join('')}
				</div>
			</section>
		`;
	}

	/**
	 * Generate debug section
	 */
	private generateDebugSection(): string {
		const { debugSection } = this._model;

		if (!debugSection.isVisible) {
			return '';
		}

		return `
			<section class="ccreq-debug">
				<h4>🔍 ccreq File Provider Debug</h4>
				<div class="ccreq-debug-content">
					<div class="ccreq-input-section">
						<label for="ccreqInput">ccreq URI:</label>
						<input
							type="text"
							id="ccreqInput"
							placeholder="ccreq:95e746dc.copilotmd"
							value="${debugSection.content.ccreqInput}"
						/>
						<button id="testCcreqBtn">Test Provider</button>
					</div>
					<div id="ccreqResults" class="ccreq-results" style="display: none;">
						<div id="ccreqResultContent"></div>
					</div>
				</div>
			</section>
		`;
	}

	/**
	 * Generate scan progress overlay
	 */
	private generateScanProgress(): string {
		return `
			<div id="scanProgress" class="scan-progress" style="display: none;">
				<div class="progress-content">
					<div class="spinner"></div>
					<span id="scanMessage">Scanning...</span>
				</div>
			</div>
		`;
	}

	/**
	 * Get Chart.js URI
	 */
	private getChartJsUri(): string {
		return this._webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, 'media', 'libs', 'node_modules', 'chart.js', 'dist', 'chart.umd.js')
		).toString();
	}

	/**
	 * Extract time series data from model
	 */
	private getTimeSeriesData(): any[] {
		const chart = this._model.timeSeriesChart;
		console.log('getTimeSeriesData: Chart isEmpty:', chart.isEmpty, 'hasData:', !!chart.data, 'hasLabels:', !!chart.data?.labels);
		if (chart.isEmpty || !chart.data || !chart.data.labels) {
			return [];
		}
		
		return chart.data.labels.map((label: string, index: number) => ({
			timestamp: label,
			value: chart.data.datasets[0]?.data[index] || 0
		}));
	}

	/**
	 * Extract event type data from model
	 */
	private getEventTypeData(): any[] {
		const chart = this._model.eventTypeChart;
		if (chart.isEmpty || !chart.data || !chart.data.labels) {
			return [];
		}
		
		return chart.data.labels.map((label: string, index: number) => ({
			type: label,
			count: chart.data.datasets[0]?.data[index] || 0
		}));
	}

	/**
	 * Extract language data from model
	 */
	private getLanguageData(): any[] {
		const chart = this._model.languageChart;
		if (chart.isEmpty || !chart.data || !chart.data.labels) {
			return [];
		}
		
		return chart.data.labels.map((label: string, index: number) => ({
			language: label,
			eventCount: chart.data.datasets[0]?.data[index] || 0
		}));
	}

	/**
	 * Generate CSS styles (extracted from git history)
	 */
	private getWebviewStyles(): string {
		return `
			<style>
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
			</style>
		`;
	}

	/**
	 * Generate JavaScript for the webview (extracted from git history and adapted)
	 */
	private getWebviewScript(analyticsData: any): string {
		return `
			const vscode = acquireVsCodeApi();

			// Safely inject analytics data
			const analyticsData = ${JSON.stringify(analyticsData)};

			// Message functions
			function sendMessage(type, data = {}) {
				vscode.postMessage({ type, ...data });
			}

			function testCcreqProvider() {
				const ccreqInput = document.getElementById('ccreqInput');
				const ccreqUri = ccreqInput.value.trim();

				if (!ccreqUri) {
					showCcreqResult(false, 'Please enter a ccreq URI', null);
					return;
				}

				showCcreqResult(null, 'Testing ccreq provider...', null);
				sendMessage('testCcreqProvider', { ccreqUri });
			}

			function showCcreqResult(success, message, data) {
				const resultsEl = document.getElementById('ccreqResults');
				const contentEl = document.getElementById('ccreqResultContent');

				resultsEl.style.display = 'block';

				if (success === null) {
					contentEl.innerHTML = \`<div class="ccreq-result-info">⏳ \${message}</div>\`;
				} else if (success) {
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
					contentEl.innerHTML = \`<div class="ccreq-result-error">❌ \${message}</div>\`;
				}
			}

			function updateTimeRange(timeRange) {
				sendMessage('updateTimeRange', { timeRange });
			}

			// Chart variables
			let timeSeriesChart = null;
			let eventTypeChart = null;
			let languageChart = null;

			// Chart rendering functions
			function renderTimeSeriesChart() {
				try {
					console.log('renderTimeSeriesChart: Starting render');
					const canvas = document.getElementById('timeSeriesChart');
					console.log('renderTimeSeriesChart: Canvas element:', canvas);
					console.log('renderTimeSeriesChart: Chart.js available:', !!window.Chart);
					if (!canvas || !window.Chart) {
						console.log('renderTimeSeriesChart: Aborting - missing canvas or Chart.js');
						return;
					}

					if (timeSeriesChart) {
						console.log('renderTimeSeriesChart: Destroying existing chart');
						timeSeriesChart.destroy();
					}

					const ctx = canvas.getContext('2d');
					const data = analyticsData.timeSeriesData;
					console.log('renderTimeSeriesChart: Time series data:', data);

					if (data.length === 0) {
						console.log('renderTimeSeriesChart: No data available, creating test chart to verify Chart.js works');
						
						// Create a simple test chart with dummy data
						const testChartData = {
							labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
							datasets: [{
								label: 'Test Data',
								data: [12, 19, 3, 5, 2],
								backgroundColor: '#007acc',
								borderColor: '#007acc',
								borderWidth: 1
							}]
						};

						timeSeriesChart = new Chart(ctx, {
							type: 'bar',
							data: testChartData,
							options: {
								responsive: true,
								maintainAspectRatio: false,
								plugins: { 
									legend: { display: true },
									title: { display: true, text: 'Test Chart (No Real Data)' }
								},
								scales: {
									y: { beginAtZero: true }
								}
							}
						});
						
						console.log('renderTimeSeriesChart: Test chart created successfully');
						return;
					}

					const chartData = {
						labels: data.map(d => {
							const date = new Date(d.timestamp);
							return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
						}),
						datasets: [{
							label: 'Daily Events',
							data: data.map(d => d.value),
							backgroundColor: getComputedStyle(document.body).getPropertyValue('--vscode-button-background'),
							borderColor: getComputedStyle(document.body).getPropertyValue('--vscode-button-background'),
							borderWidth: 1
						}]
					};

					timeSeriesChart = new Chart(ctx, {
						type: 'bar',
						data: chartData,
						options: {
							responsive: true,
							maintainAspectRatio: false,
							plugins: { legend: { display: false } },
							scales: {
								x: {
									display: true,
									grid: { color: getComputedStyle(document.body).getPropertyValue('--vscode-panel-border') },
									ticks: { color: getComputedStyle(document.body).getPropertyValue('--vscode-foreground') }
								},
								y: {
									display: true,
									grid: { color: getComputedStyle(document.body).getPropertyValue('--vscode-panel-border') },
									ticks: { color: getComputedStyle(document.body).getPropertyValue('--vscode-foreground') }
								}
							}
						}
					});
				} catch (error) {
					console.error('Error rendering time series chart:', error);
				}
			}

			function renderEventTypeChart() {
				try {
					console.log('renderEventTypeChart: Starting render');
					const canvas = document.getElementById('eventTypeChart');
					console.log('renderEventTypeChart: Canvas element:', canvas);
					if (!canvas || !window.Chart) {
						console.log('renderEventTypeChart: Aborting - missing canvas or Chart.js');
						return;
					}

					if (eventTypeChart) {
						console.log('renderEventTypeChart: Destroying existing chart');
						eventTypeChart.destroy();
					}

					const ctx = canvas.getContext('2d');
					const data = analyticsData.eventTypeDistribution;
					console.log('renderEventTypeChart: Event type data:', data);

					if (data.length === 0) {
						console.log('renderEventTypeChart: No data available, creating test chart');
						
						// Create a simple test doughnut chart
						const testChartData = {
							labels: ['Completion', 'Chat', 'Inline', 'Debug'],
							datasets: [{
								data: [30, 25, 25, 20],
								backgroundColor: ['#007acc', '#ff6b35', '#4caf50', '#ff9800']
							}]
						};

						eventTypeChart = new Chart(ctx, {
							type: 'doughnut',
							data: testChartData,
							options: {
								responsive: true,
								maintainAspectRatio: false,
								plugins: { 
									legend: { display: true, position: 'bottom' },
									title: { display: true, text: 'Test Event Types (No Real Data)' }
								}
							}
						});
						
						console.log('renderEventTypeChart: Test chart created successfully');
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
										font: { size: 10 }
									}
								}
							}
						}
					});
				} catch (error) {
					console.error('Error rendering event type chart:', error);
				}
			}

			function renderLanguageChart() {
				try {
					const canvas = document.getElementById('languageChart');
					if (!canvas || !window.Chart) return;

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
							plugins: { legend: { display: false } },
							scales: {
								x: {
									display: true,
									grid: { color: getComputedStyle(document.body).getPropertyValue('--vscode-panel-border') },
									ticks: { color: getComputedStyle(document.body).getPropertyValue('--vscode-foreground') }
								},
								y: {
									display: true,
									grid: { color: getComputedStyle(document.body).getPropertyValue('--vscode-panel-border') },
									ticks: { color: getComputedStyle(document.body).getPropertyValue('--vscode-foreground') }
								}
							}
						}
					});
				} catch (error) {
					console.error('Error rendering language chart:', error);
				}
			}

			// Event listeners setup
			function setupEventListeners() {
				const testCcreqBtn = document.getElementById('testCcreqBtn');
				if (testCcreqBtn) testCcreqBtn.addEventListener('click', testCcreqProvider);
			}

			// Initialize charts
			function initializeCharts() {
				console.log('initializeCharts called');
				console.log('Chart.js available:', typeof window.Chart !== 'undefined');
				console.log('Analytics data:', analyticsData);
				
				if (typeof window.Chart !== 'undefined') {
					console.log('Chart.js loaded, rendering charts...');
					renderTimeSeriesChart();
					renderEventTypeChart();
					renderLanguageChart();
				} else {
					console.log('Chart.js not ready, retrying...');
					setTimeout(initializeCharts, 100);
				}
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
					case 'processing':
						messageEl.textContent = message.message || 'Processing...';
						break;
					case 'complete':
						messageEl.textContent = \`Complete: \${message.eventsFound} events found\`;
						setTimeout(() => progressEl.style.display = 'none', 2000);
						break;
					case 'error':
						messageEl.textContent = \`Error: \${message.error}\`;
						setTimeout(() => progressEl.style.display = 'none', 3000);
						break;
				}
			}

			function handleCcreqTestResult(message) {
				if (message.success) {
					const openedText = message.openedInEditor ? ' (Opened in editor)' : '';
					showCcreqResult(true, 'ccreq provider test successful!' + openedText, message);
				} else {
					showCcreqResult(false, message.error || 'Unknown error', null);
				}
			}

			// Initialize when DOM is ready
			if (document.readyState === 'loading') {
				document.addEventListener('DOMContentLoaded', () => {
					setupEventListeners();
					setTimeout(initializeCharts, 50);
				});
			} else {
				setupEventListeners();
				setTimeout(initializeCharts, 50);
			}
		`;
	}

	/**
	 * Generate error HTML
	 */
	private generateErrorHtml(error: string): string {
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
			<div class="error">${WebviewUtils.escapeHtml(error)}</div>
			<button onclick="location.reload()">Retry</button>
		</body>
		</html>`;
	}
}
