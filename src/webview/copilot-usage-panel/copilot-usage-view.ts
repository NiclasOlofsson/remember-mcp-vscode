import * as vscode from 'vscode';
import { CopilotUsageModel } from './copilot-usage-model';
import { WebviewUtils } from '../shared/webview-utils';
import { ILogger } from '../../types/logger';

/**
 * View for Copilot Usage Panel
 * Handles HTML generation and UI rendering
 */
export class CopilotUsageView {
	constructor(
		private readonly _webview: vscode.Webview,
		private readonly _model: CopilotUsageModel,
		private readonly _extensionUri: vscode.Uri,
		private readonly _logger: ILogger
	) {
		// Set up data binding: model changes update the view
		this._model.onDataChanged(async () => {
			try {
				this._logger.trace(`Model data changed, re-rendering view with ${this._model.stats.length} entries: ${JSON.stringify(this._model.stats)}`);
				await this.render();
			} catch (error) {
				this._logger.error('Error rendering CopilotUsageView:', error);
			}
		});

	}

	/**
     * Generate and set the HTML content for the webview
     */
	public async render(): Promise<void> {
		const html = await this.generateHtml();
		this._webview.html = html;
	}

	/**
     * Generate HTML content based on usage statistics
     */
	private async generateHtml(): Promise<string> {
		const tableRows = this.generateTableRows();
		const sharedStyles = await WebviewUtils.getSharedStyles(this._extensionUri);

		// Get Chart.js URI from media/libs/chart.umd.js
		const chartJsUri = this._webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, 'media', 'libs', 'chart.umd.js')
		);

		return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
            <title>Copilot Usage</title>
            ${sharedStyles}
            <script src="${chartJsUri}"></script>
            <style>
                tr {
                    background-color: var(--vscode-sideBar-background);
                }
                @keyframes flash-blink {
                    0%   { background-color: var(--vscode-sideBar-background); color: var(--vscode-foreground); }
                    40%  { background-color: var(--vscode-foreground); color: var(--vscode-sideBar-background); }
                    100% { background-color: var(--vscode-sideBar-background); color: var(--vscode-foreground); }
                }
                .flash-row {
                    animation: flash-blink 0.8s ease;
                }
            </style>
        </head>
        <body>
            <div class="summary">
                Track and analyze Copilot model usage in real time as you work.
            </div>
            
            <div class="summary">
                Total: ${this._model.totalRequests} requests
            </div>
            
            <table>
                <thead>
                    <tr>
                        <th>Model</th>
                        <th style="text-align: right;">Count</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>

            <button class="secondary" onclick="sendMessage('clearStats')" ${this._model.hasData() ? '' : 'disabled'}>Clear</button>
            <button onclick="sendMessage('refresh')">Refresh</button>
            
            ${WebviewUtils.getSharedScript()}
            <script>
                // Flash updated rows
                document.addEventListener('DOMContentLoaded', function() {
                    document.querySelectorAll('.flash-row').forEach(row => {
                        setTimeout(() => {
                            row.classList.remove('flash-row');
                        }, 800);
                    });
                });
                // Chart.js is now available as window.Chart
                // Example: window.Chart (add chart rendering here as needed)
            </script>
        </body>
        </html>`;
	}

	/**
     * Generate table rows for usage statistics
     */
	private generateTableRows(): string {
		if (!this._model.hasData()) {
			return '<tr><td colspan="2" class="no-data">No usage data available<br/>Start using Copilot to track usage</td></tr>';
		}

		return this._model.stats.map(({ model, count, updated }) =>
			`<tr${updated ? ' class="flash-row"' : ''}><td>${WebviewUtils.escapeHtml(model)}</td><td class="count">${count}</td></tr>`
		).join('');
	}
}
