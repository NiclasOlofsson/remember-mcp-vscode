import * as vscode from 'vscode';
import { RememberMcpManager } from '../../extension';

export class CopilotUsagePanel implements vscode.WebviewViewProvider {
    public static readonly viewType = 'remember-mcp-usage-panel';

    constructor(private readonly extensionUri: vscode.Uri, private rememberManager: RememberMcpManager) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        // Listen for usage stats changes to update the webview
        this.rememberManager.usageStatsManager.onDidChangeStats(() => {
            webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
        });

        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.type) {
                case 'clearStats':
                    this.rememberManager.clearModelUsageStats();
                    vscode.window.showInformationMessage('Model usage statistics cleared.');
                    break;
                case 'refresh':
                    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
                    break;
            }
        });
    }

    private getHtmlForWebview(webview: vscode.Webview) {
        const usageStats = this.rememberManager.getModelUsageStats();
        const totalRequests = Array.from(usageStats.values()).reduce((sum: number, count: number) => sum + count, 0);
        const sortedStats = Array.from(usageStats.entries()).sort((a: [string, number], b: [string, number]) => b[1] - a[1]);

        let tableRows = '';
        if (sortedStats.length === 0) {
            tableRows = '<tr><td colspan="2" class="no-data">No usage data available<br/>Start using Copilot to track usage</td></tr>';
        } else {
            tableRows = sortedStats.map(([model, count]) => 
                `<tr><td>${model}</td><td class="count">${count}</td></tr>`
            ).join('');
        }

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
            <title>Copilot Usage</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-sideBar-background);
                    margin: 0;
                    padding: 8px;
                }
                
                h3 {
                    margin: 0 0 8px 0;
                    font-size: 13px;
                    font-weight: 600;
                    color: var(--vscode-sideBarTitle-foreground);
                }
                
                .summary {
                    margin-bottom: 8px;
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                }
                
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 8px;
                    font-size: 12px;
                }
                
                th {
                    text-align: left;
                    padding: 4px 8px 4px 0;
                    font-weight: 600;
                    color: var(--vscode-sideBarTitle-foreground);
                    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
                }
                
                td {
                    padding: 2px 8px 2px 0;
                    color: var(--vscode-sideBar-foreground);
                }
                
                td.count {
                    text-align: right;
                    font-variant-numeric: tabular-nums;
                }
                
                tr:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                
                .no-data {
                    text-align: center;
                    color: var(--vscode-descriptionForeground);
                    font-style: italic;
                    padding: 16px 0;
                }
                
                button {
                    width: 100%;
                    padding: 4px 8px;
                    margin: 2px 0;
                    border: none;
                    border-radius: 2px;
                    font-size: 11px;
                    cursor: pointer;
                    font-family: var(--vscode-font-family);
                }
                
                button:not(:disabled) {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                }
                
                button:not(:disabled):hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                
                button:disabled {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    cursor: default;
                }
                
                button.secondary:not(:disabled) {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }
                
                button.secondary:not(:disabled):hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
            </style>
        </head>
        <body>
            <div class="summary">
                Track and analyze Copilot model usage in real time as you work.
            </div>
            
            <div class="summary">
                Total: ${totalRequests} requests
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
            
            <button class="secondary" onclick="sendMessage('clearStats')" ${sortedStats.length === 0 ? 'disabled' : ''}>Clear</button>
            <button onclick="sendMessage('refresh')">Refresh</button>
            
            <script>
                const vscode = acquireVsCodeApi();
                
                function sendMessage(type) {
                    vscode.postMessage({
                        type: type
                    });
                }
            </script>
        </body>
        </html>`;
    }
}
