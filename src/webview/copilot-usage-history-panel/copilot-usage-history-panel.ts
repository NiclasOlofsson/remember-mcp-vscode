/**
 * Copilot Usage History Panel using MVVM architecture with micro-view-models
 * Refactored to follow the same pattern as CopilotUsagePanel
 */

import * as vscode from 'vscode';
import { EnhancedAnalyticsEngine } from '../../storage/enhanced-analytics-engine';
import { ILogger } from '../../types/logger';
import { CopilotUsageHistoryModel } from './copilot-usage-history-model';
import { CopilotUsageHistoryView } from './copilot-usage-history-view';

export class CopilotUsageHistoryPanel implements vscode.WebviewViewProvider, vscode.Disposable {
	public static readonly viewType = 'copilot-usage-history-panel';

	private _model: CopilotUsageHistoryModel | null = null;
	private _view: CopilotUsageHistoryView | null = null;
	private _disposables: vscode.Disposable[] = [];

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly context: vscode.ExtensionContext,
		private readonly logger: ILogger
	) { }

	/**
	 * Resolve the webview view and set up model and view
	 */
	public async resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): Promise<void> {
		// Configure webview options
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri]
		};

		try {
			// Initialize enhanced analytics engine
			const analyticsEngine = new EnhancedAnalyticsEngine(this.context, this.logger);
			
			// Initialize model and view immediately (before analytics engine is ready)
			this._model = new CopilotUsageHistoryModel(analyticsEngine, this.logger);
			this._view = new CopilotUsageHistoryView(webviewView.webview, this._model, this.extensionUri, this.logger);

			// Handle messages from the webview
			const messageHandler = webviewView.webview.onDidReceiveMessage(async (message) => {
				await this.handleMessage(message);
			});
			this._disposables.push(messageHandler);

			// Render view immediately (will show loading/empty state)
			await this._view.render();

			// Initialize analytics engine in background (non-blocking)
			this.initializeAnalyticsAsync(analyticsEngine);

		} catch (error) {
			this.logger.error('Failed to initialize usage history panel:', error);
			webviewView.webview.html = this.generateErrorHtml(String(error));
		}
	}

	/**
	 * Initialize analytics engine asynchronously in the background
	 */
	private initializeAnalyticsAsync(analyticsEngine: EnhancedAnalyticsEngine): void {
		// Fire and forget - don't await
		analyticsEngine.initialize().then(() => {
			this.logger.info('Enhanced analytics engine initialized successfully');
			// Analytics engine is ready, model will handle data loading
		}).catch((error: any) => {
			this.logger.error('Enhanced analytics engine initialization failed:', error);
			if (this._model) {
				// Model should handle this error gracefully
			}
		});
	}

	/**
	 * Handle messages from the webview
	 */
	private async handleMessage(message: { type: string; [key: string]: any }): Promise<void> {
		if (!this._model) {
			this.logger.warn('Model not available for message handling');
			return;
		}

		this.logger.info(`Received message: ${message.type}`);

		try {
			switch (message.type) {
				case 'refresh':
					await this.handleRefresh();
					break;
				case 'updateTimeRange':
					await this.handleUpdateTimeRange(message.timeRange);
					break;
				case 'scanChatSessions':
					await this.scanChatSessions();
					break;
				case 'testCcreqProvider':
					await this.handleTestCcreqProvider(message.ccreqUri);
					break;
				case 'showMore':
					await this.handleShowMore(message.table);
					break;
				default:
					this.logger.warn(`Unknown message type: ${message.type}`);
			}
		} catch (error) {
			this.logger.error(`Error handling message ${message.type}:`, error);
			vscode.window.showErrorMessage(`Failed to ${message.type}: ${error}`);
		}
	}

	/**
	 * Handle refresh request
	 */
	private async handleRefresh(): Promise<void> {
		if (!this._model) {return;}

		try {
			await this._model.refreshAllData();
			this.logger.info('Usage history data refreshed successfully');
		} catch (error) {
			this.logger.error('Error refreshing data:', error);
			vscode.window.showErrorMessage('Failed to refresh usage data.');
		}
	}

	/**
	 * Handle time range update
	 */
	private async handleUpdateTimeRange(timeRange: '7d' | '30d' | '90d'): Promise<void> {
		if (!this._model) {return;}

		try {
			await this._model.updateTimeRange(timeRange);
			this.logger.info(`Time range updated to ${timeRange}`);
		} catch (error) {
			this.logger.error('Error updating time range:', error);
			vscode.window.showErrorMessage('Failed to update time range.');
		}
	}

	/**
	 * Perform the actual clear data operation without confirmation
	 */
	private async performClearData(): Promise<void> {
		if (!this._model) {return;}

		try {
			const result = await this._model.clearData();
			this.logger.info(`Data cleared: ${result.deletedFiles} files, ${result.deletedEvents} events`);
		} catch (error) {
			this.logger.error('Error clearing data:', error);
			vscode.window.showErrorMessage('Failed to clear usage data.');
		}
	}

	/**
	 * Handle test ccreq provider request
	 */
	private async handleTestCcreqProvider(ccreqUri: string): Promise<void> {
		if (!this._model) {return;}

		try {
			const result = await this._model.testCcreqProvider(ccreqUri);
			
			if (!result.success) {
				vscode.window.showErrorMessage(`❌ ccreq provider test failed: ${result.message}`);
			}

		} catch (error) {
			this.logger.error('ccreq provider test failed:', error);
			vscode.window.showErrorMessage(`Failed to test ccreq provider: ${error}`);
		}
	}

	/**
	 * Handle show more request for tables
	 */
	private async handleShowMore(tableName: string): Promise<void> {
		// This would expand the table to show more items
		// For now, just log the request
		this.logger.info(`Show more requested for table: ${tableName}`);
		// TODO: Implement expand functionality in model
	}

	/**
	 * Public API methods (called from commands)
	 */

	/**
	 * Refresh data (public method for command interface)
	 */
	public async refreshData(): Promise<void> {
		if (this._model) {
			await this._model.refreshAllData();
		}
	}

	/**
	 * Scan chat sessions (public method for command interface)
	 */
	public async scanChatSessions(): Promise<void> {
		if (!this._model) {return;}

		try {
			this.logger.info('Starting chat session scan...');
			
			const result = await this._model.scanChatSessions();
			
			if (result.events.length > 0) {
				this.logger.info(`Session scan complete: ${result.events.length} events from ${result.stats.totalSessions} sessions`);
				vscode.window.showInformationMessage(
					`Processed ${result.events.length} Copilot usage events from ${result.stats.totalSessions} chat sessions`
				);
			} else {
				this.logger.info('No chat sessions found');
				vscode.window.showInformationMessage('No Copilot chat sessions found');
			}

		} catch (error) {
			this.logger.error('Chat session scan failed:', error);
			vscode.window.showErrorMessage(`Failed to scan chat sessions: ${error}`);
		}
	}

	/**
	 * Export usage data (public method for command interface)
	 */
	public async exportData(_options: { includeRawEvents?: boolean; includeAnalytics?: boolean } = {}): Promise<void> {
		if (!this._model) {return;}

		try {
			const exportData = await this._model.getExportData();

			// Save to file
			const exportPath = await vscode.window.showSaveDialog({
				defaultUri: vscode.Uri.file(`copilot-usage-export-${new Date().toISOString().split('T')[0]}.json`),
				filters: {
					'JSON files': ['json'],
					'All files': ['*']
				}
			});

			if (exportPath) {
				await vscode.workspace.fs.writeFile(
					exportPath, 
					Buffer.from(JSON.stringify(exportData, null, 2), 'utf8')
				);
				vscode.window.showInformationMessage(`Usage data exported to ${exportPath.fsPath}`);
				this.logger.info(`Data exported to ${exportPath.fsPath}`);
			}

		} catch (error) {
			this.logger.error('Error exporting data:', error);
			vscode.window.showErrorMessage('Failed to export usage data.');
		}
	}

	/**
	 * Clear storage (public method for command interface)
	 */
	/**
	 * Clear storage (public method for command interface)
	 * This method is called from the toolbar command which already shows confirmation
	 */
	public async clearStorage(): Promise<void> {
		await this.performClearData();
	}

	/**
	 * Check if usage data exists (public method for command interface)
	 */
	public hasData(): boolean {
		return this._model?.globalState.hasData || false;
	}

	/**
	 * Generate error HTML for display in webview
	 */
	private generateErrorHtml(message: string): string {
		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Error</title>
			<style>
				body { 
					font-family: var(--vscode-font-family); 
					color: var(--vscode-foreground);
					background-color: var(--vscode-sideBar-background);
					padding: 20px;
				}
				.error { 
					color: var(--vscode-errorForeground);
					background-color: var(--vscode-inputValidation-errorBackground);
					padding: 12px;
					border-radius: 4px;
					border: 1px solid var(--vscode-inputValidation-errorBorder);
					text-align: center;
				}
			</style>
		</head>
		<body>
			<div class="error">
				<h3>Error Loading Usage History</h3>
				<p>${message}</p>
				<button onclick="location.reload()">Retry</button>
			</div>
		</body>
		</html>`;
	}

	/**
	 * Dispose of the panel and clean up resources
	 */
	public dispose(): void {
		this._disposables.forEach(d => d.dispose());
		this._disposables = [];

		if (this._model) {
			this._model.dispose();
			this._model = null;
		}

		this._view = null;
	}
}
