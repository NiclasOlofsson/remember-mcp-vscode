import * as vscode from 'vscode';
import { UsageStats } from './copilot-usage-model';
import { WebviewUtils } from '../shared/webview-utils';

/**
 * View for Copilot Usage Panel
 * Handles HTML generation and UI rendering
 */
export class CopilotUsageView {
    constructor(
        private readonly webview: vscode.Webview,
        private readonly extensionUri: vscode.Uri
    ) {}

    /**
     * Generate and set the HTML content for the webview
     */
    public async render(stats: UsageStats): Promise<void> {
        const html = await this.generateHtml(stats);
        this.webview.html = html;
    }

    /**
     * Generate HTML content based on usage statistics
     */
    private async generateHtml(stats: UsageStats): Promise<string> {
        const tableRows = this.generateTableRows(stats);
        const sharedStyles = await WebviewUtils.getSharedStyles(this.extensionUri);

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
            <title>Copilot Usage</title>
            ${sharedStyles}
        </head>
        <body>
            <div class="summary">
                Track and analyze Copilot model usage in real time as you work.
            </div>
            
            <div class="summary">
                Total: ${stats.totalRequests} requests
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
            
            <button class="secondary" onclick="sendMessage('clearStats')" ${stats.sortedStats.length === 0 ? 'disabled' : ''}>Clear</button>
            <button onclick="sendMessage('refresh')">Refresh</button>
            
            ${WebviewUtils.getSharedScript()}
        </body>
        </html>`;
    }

    /**
     * Generate table rows for usage statistics
     */
    private generateTableRows(stats: UsageStats): string {
        if (stats.sortedStats.length === 0) {
            return '<tr><td colspan="2" class="no-data">No usage data available<br/>Start using Copilot to track usage</td></tr>';
        }
        
        return stats.sortedStats.map(([model, count]) => 
            `<tr><td>${WebviewUtils.escapeHtml(model)}</td><td class="count">${count}</td></tr>`
        ).join('');
    }
}
