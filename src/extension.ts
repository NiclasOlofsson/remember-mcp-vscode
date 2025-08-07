import * as vscode from 'vscode';

import * as fs from 'fs';
import * as path from 'path';

export class McpServerManager {
    private outputChannel: vscode.OutputChannel;
    private statusBarItem: vscode.StatusBarItem;
    private mcpProvider: vscode.Disposable | null = null;
    private _onDidChangeTreeData: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData: vscode.Event<void> = this._onDidChangeTreeData.event;
    private modelUsageStats: Map<string, number> = new Map();
    
    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Remember MCP');
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.command = 'remember-mcp.showPanel';
        this.updateStatusBar('stopped');
        this.statusBarItem.show();
    }

    /**
     * Utility: Get the Copilot Chat extension's log file path by navigating from our globalStoragePath.
     * @param myStoragePath Your extension's globalStoragePath
     * @returns Copilot Chat log file path (if found), else null
     */
    static getCopilotChatLogPath(myLogDir: string, outputChannel?: vscode.OutputChannel): string | null {
        // Helper for debug output
        const debug = (msg: string, ...args: any[]) => {
            if (outputChannel) {
                outputChannel.appendLine('[DEBUG] ' + msg + (args.length ? ' ' + args.map(a => JSON.stringify(a)).join(' ') : ''));
            }
        };

        // Go up one directory from our log dir to exthost, then into GitHub.copilot-chat
        const exthostDir = path.dirname(myLogDir);
        debug('exthostDir:', exthostDir);
        const copilotLogDir = path.join(exthostDir, 'GitHub.copilot-chat');
        debug('Copilot Chat log directory:', copilotLogDir);
        if (!fs.existsSync(copilotLogDir)) {
            debug('Copilot Chat log directory does not exist:', copilotLogDir);
            return null;
        }
        // Find .log file(s)
        const files = fs.readdirSync(copilotLogDir);
        debug('Files in Copilot Chat log directory:', files);
        const logFile = files.find(f => f.endsWith('.log'));
        if (logFile) {
            const logPath = path.join(copilotLogDir, logFile);
            debug('Found Copilot Chat log file:', logPath);
            return logPath;
        } else {
            debug('No .log file found in Copilot Chat log directory.');
        }
        return null;
    }

    /**
     * Utility: Tail a file and call a callback with new lines as they are appended.
     * Uses dual watchers: fs.watch for fast events + fs.watchFile for reliable polling fallback.
     * @param filePath Path to the log file
     * @param onLine Callback for each new line
     * @param pollingInterval Polling interval in milliseconds (default: 1000ms)
     * @returns Disposable to stop watching
     */
    static tailFile(filePath: string, onLine: (line: string) => void, pollingInterval: number = 1000): vscode.Disposable {
        let fileSize = 0;
        let watching = true;
        let leftover = '';

        // Initial stat
        if (fs.existsSync(filePath)) {
            fileSize = fs.statSync(filePath).size;
        }

        // Helper function to process file changes
        const processFileChange = () => {
            if (!watching || !fs.existsSync(filePath)) {
                return;
            }
            const stats = fs.statSync(filePath);
            if (stats.size > fileSize) {
                const stream = fs.createReadStream(filePath, {
                    start: fileSize,
                    end: stats.size
                });
                stream.on('data', chunk => {
                    const lines = (leftover + chunk.toString()).split(/\r?\n/);
                    leftover = lines.pop() || '';
                    for (const line of lines) {
                        if (line.trim()) {
                            onLine(line);
                        }
                    }
                });
                stream.on('end', () => {
                    fileSize = stats.size;
                });
            }
        };

        // Only polling-based detection (fs.watchFile)
        fs.watchFile(filePath, { interval: pollingInterval }, (curr, prev) => {
            if (!watching) {
                return;
            }
            // Only process if file actually changed
            if (curr.mtime !== prev.mtime || curr.size !== prev.size) {
                processFileChange();
            }
        });

        return {
            dispose: () => {
                watching = false;
                fs.unwatchFile(filePath);
            }
        };
    }

    /**
     * Extract model name from a Copilot log line
     * @param line Log line to parse
     * @returns Model name if found, null otherwise
     */
    static extractModelFromLogLine(line: string): string | null {
        // Pattern: [info] ccreq:... copilotmd | success | MODEL_NAME | ...ms |
        const match = line.match(/\[info\] ccreq:.*copilotmd \| success \| (.+?) \| \d+ms \|/);
        return match ? match[1] : null;
    }

    /**
     * Record a model usage in the statistics
     * @param modelName Name of the model used
     */
    recordModelUsage(modelName: string): void {
        const currentCount = this.modelUsageStats.get(modelName) || 0;
        this.modelUsageStats.set(modelName, currentCount + 1);
        this._onDidChangeTreeData.fire(); // Refresh the tree view
    }

    /**
     * Get current model usage statistics
     * @returns Map of model names to usage counts
     */
    getModelUsageStats(): Map<string, number> {
        return new Map(this.modelUsageStats);
    }

    /**
     * Clear all model usage statistics
     */
    clearModelUsageStats(): void {
        this.modelUsageStats.clear();
        this._onDidChangeTreeData.fire();
    }

    private updateStatusBar(status: 'running' | 'stopped' | 'error') {
        switch (status) {
            case 'running':
                this.statusBarItem.text = '$(server) MCP Running';
                this.statusBarItem.backgroundColor = undefined;
                vscode.commands.executeCommand('setContext', 'remember-mcp:enabled', true);
                break;
            case 'stopped':
                this.statusBarItem.text = '$(server) MCP Stopped';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                vscode.commands.executeCommand('setContext', 'remember-mcp:enabled', false);
                break;
            case 'error':
                this.statusBarItem.text = '$(error) MCP Error';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                vscode.commands.executeCommand('setContext', 'remember-mcp:enabled', false);
                break;
        }
        this._onDidChangeTreeData.fire();
    }

    async startServer(): Promise<void> {
        if (this.mcpProvider) {
            this.outputChannel.appendLine('MCP server is already running');
            return;
        }

        const config = vscode.workspace.getConfiguration('remember-mcp');
        const serverCommand = config.get<string>('server.command', 'pipx run mode-manager-mcp');
        
        // Check VS Code MCP settings
        const chatConfig = vscode.workspace.getConfiguration('chat');
        const mcpEnabled = chatConfig.get('mcp.enabled');
        this.outputChannel.appendLine(`VS Code chat.mcp.enabled setting: ${mcpEnabled}`);
        
        if (mcpEnabled === false) {
            this.outputChannel.appendLine('WARNING: MCP is disabled in VS Code settings');
            vscode.window.showWarningMessage('MCP is disabled in VS Code settings. Enable "chat.mcp.enabled" to use MCP servers.');
            this.updateStatusBar('error');
            return;
        }
        
        this.outputChannel.appendLine(`Registering MCP server with command: ${serverCommand}`);
        this.outputChannel.show();

        try {
            // Parse command and arguments
            const [command, ...args] = serverCommand.split(' ');
            
            this.outputChannel.appendLine(`Command: ${command}`);
            this.outputChannel.appendLine(`Arguments: ${JSON.stringify(args)}`);
            
            // Register the MCP server using the official VS Code MCP API
            this.mcpProvider = vscode.lm.registerMcpServerDefinitionProvider('remember-mcp-provider', {
                provideMcpServerDefinitions: async () => {
                    this.outputChannel.appendLine('Providing MCP server definition');
                    const serverDef = new vscode.McpStdioServerDefinition(
                        'Remember MCP (Mode Manager)',
                        command,
                        args,
                        {}, // environment variables
                        '1.0.0' // version
                    );
                    this.outputChannel.appendLine(`Server definition created for command: ${command}`);
                    return [serverDef];
                },
                resolveMcpServerDefinition: async (server) => {
                    this.outputChannel.appendLine(`Resolving MCP server definition for: ${command}`);
                    return server;
                }
            });

            this.updateStatusBar('running');
            this.outputChannel.appendLine('MCP server provider registered successfully');
            vscode.window.showInformationMessage('MCP Server registered with VS Code');

            // Check for available tools after a short delay
            setTimeout(() => {
                const tools = vscode.lm.tools;
                this.outputChannel.appendLine(`Available LM tools: ${tools.length}`);
                if (tools.length > 0) {
                    this.outputChannel.appendLine(`Tool names: ${tools.map(t => t.name).join(', ')}`);
                } else {
                    this.outputChannel.appendLine('No tools are currently available to VS Code');
                }
            }, 3000);

        } catch (error) {
            this.outputChannel.appendLine(`Failed to register MCP server: ${error}`);
            this.updateStatusBar('error');
            vscode.window.showErrorMessage(`Failed to register MCP server: ${error}`);
        }
    }

    stopServer(): void {
        if (!this.mcpProvider) {
            this.outputChannel.appendLine('MCP server provider is not registered');
            return;
        }

        this.outputChannel.appendLine('Unregistering MCP server provider...');
        this.mcpProvider.dispose();
        this.mcpProvider = null;
        this.updateStatusBar('stopped');
        this.outputChannel.appendLine('MCP server provider unregistered');
        vscode.window.showInformationMessage('MCP Server unregistered');
    }

    async restartServer(): Promise<void> {
        this.stopServer();
        await new Promise(resolve => setTimeout(resolve, 500));
        await this.startServer();
    }

    isRunning(): boolean {
        return this.mcpProvider !== null;
    }

    dispose(): void {
        this.stopServer();
        this.outputChannel.dispose();
        this.statusBarItem.dispose();
        this._onDidChangeTreeData.dispose();
    }
}

export class McpTreeDataProvider implements vscode.TreeDataProvider<McpTreeItem> {
    readonly onDidChangeTreeData: vscode.Event<McpTreeItem | undefined | null | void>;

    constructor(private serverManager: McpServerManager) {
        this.onDidChangeTreeData = serverManager.onDidChangeTreeData;
    }

    refresh(): void {
        // Tree will refresh automatically via the server manager's event emitter
    }

    getTreeItem(element: McpTreeItem): vscode.TreeItem {
        console.log(`getTreeItem called with element:`, { 
            label: element.label, 
            description: element.description,
            toString: element.toString(),
            constructor: element.constructor.name
        });
        return element;
    }

    getChildren(element?: McpTreeItem): Thenable<McpTreeItem[]> {
        console.log(`getChildren called with element:`, element ? { label: element.label, toString: element.toString() } : 'undefined');
        
        if (!element) {
            // Root items
            const serverStatus = this.serverManager.isRunning() ? 'Registered with VS Code' : 'Not Registered';
            console.log('Creating root tree items, serverStatus:', serverStatus);
            
            const statusItem = new McpTreeItem(
                'Server Status',
                serverStatus,
                vscode.TreeItemCollapsibleState.None,
                this.serverManager.isRunning() ? 'statusBarItem.activeBackground' : 'statusBarItem.warningBackground'
            );
            console.log('Created statusItem with label:', statusItem.label);
            
            const actionsItem = new McpTreeItem(
                'Actions',
                'Available actions',
                vscode.TreeItemCollapsibleState.Expanded
            );
            console.log('Created actionsItem with label:', actionsItem.label);
            
            const usageStats = this.serverManager.getModelUsageStats();
            const totalRequests = Array.from(usageStats.values()).reduce((sum, count) => sum + count, 0);
            const usageItem = new McpTreeItem(
                'Copilot Usage',
                `${totalRequests} total requests`,
                vscode.TreeItemCollapsibleState.Collapsed
            );
            console.log('Created usageItem with label:', usageItem.label);
            
            return Promise.resolve([statusItem, actionsItem, usageItem]);
        } else if (element.label === 'Actions') {
            console.log('Creating action tree items for Actions element');
            const actionLabel = this.serverManager.isRunning() ? 'Unregister Server' : 'Register Server';
            const actionDescription = this.serverManager.isRunning() ? 'Remove from VS Code MCP' : 'Add to VS Code MCP';
            const actionCommand = this.serverManager.isRunning() ? 'remember-mcp.stopServer' : 'remember-mcp.startServer';
            
            console.log('Action details:', { actionLabel, actionDescription, actionCommand });
            
            const actionItem = new McpTreeItem(
                actionLabel,
                actionDescription,
                vscode.TreeItemCollapsibleState.None,
                undefined,
                actionCommand
            );
            console.log('Created actionItem with label:', actionItem.label);
            
            const restartItem = new McpTreeItem(
                'Restart Registration',
                'Re-register with VS Code',
                vscode.TreeItemCollapsibleState.None,
                undefined,
                'remember-mcp.restartServer'
            );
            console.log('Created restartItem with label:', restartItem.label);
            
            const outputItem = new McpTreeItem(
                'Show Output',
                'View extension logs',
                vscode.TreeItemCollapsibleState.None,
                undefined,
                'remember-mcp.showOutput'
            );
            console.log('Created outputItem with label:', outputItem.label);
            
            return Promise.resolve([actionItem, restartItem, outputItem]);
        } else if (element.label === 'Copilot Usage') {
            console.log('Creating usage tree items for Copilot Usage element');
            const usageStats = this.serverManager.getModelUsageStats();
            const usageItems: McpTreeItem[] = [];
            
            if (usageStats.size === 0) {
                const noDataItem = new McpTreeItem(
                    'No usage data',
                    'Start log tailing to track usage',
                    vscode.TreeItemCollapsibleState.None
                );
                usageItems.push(noDataItem);
            } else {
                // Sort by usage count (descending)
                const sortedStats = Array.from(usageStats.entries()).sort((a, b) => b[1] - a[1]);
                
                for (const [model, count] of sortedStats) {
                    const usageItem = new McpTreeItem(
                        model,
                        `${count} requests`,
                        vscode.TreeItemCollapsibleState.None
                    );
                    usageItems.push(usageItem);
                }
                
                // Add clear action
                const clearItem = new McpTreeItem(
                    'Clear Statistics',
                    'Reset all usage counters',
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    'remember-mcp.clearUsageStats'
                );
                usageItems.push(clearItem);
            }
            
            return Promise.resolve(usageItems);
        }
        console.log('No matching element, returning empty array');
        return Promise.resolve([]);
    }
}

export class McpTreeItem extends vscode.TreeItem {
    public readonly label: string;
    
    constructor(
        label: string,
        public readonly description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly color?: string,
        public readonly commandId?: string
    ) {
        // Validate and ensure label is never empty before calling super
        const validatedLabel = (label && typeof label === 'string' && label.trim()) ? label.trim() : 'Unknown Item';
        
        // Call parent constructor with validated label
        super(validatedLabel, collapsibleState);
        
        // Set our readonly label property
        this.label = validatedLabel;
        
        // Set other properties
        this.description = description || '';
        this.tooltip = `${validatedLabel}: ${this.description}`;
        
        if (commandId) {
            this.command = {
                command: commandId,
                title: validatedLabel
            };
        }
        
        if (color) {
            this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor(color));
        }
    }
}

export class McpPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'remember-mcp-panel';

    constructor(private readonly extensionUri: vscode.Uri, private serverManager: McpServerManager) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.type) {
                case 'start':
                    await this.serverManager.startServer();
                    break;
                case 'stop':
                    this.serverManager.stopServer();
                    break;
                case 'restart':
                    this.serverManager.restartServer();
                    break;
                case 'tailCopilotLog':
                    vscode.commands.executeCommand('remember-mcp.tailCopilotLog');
                    break;
            }
        });
    }

    private getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
            <title>Server Control</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-sideBar-background);
                    margin: 0;
                    padding-bottom: 13px;
                    padding-left: 20px;
                    padding-right: 20px;
                    padding-top: 0px;
                }
                
                h3 {
                    margin: 0 0 8px 0;
                    font-size: 13px;
                    font-weight: 600;
                    color: var(--vscode-sideBarTitle-foreground);
                }
                
                .info {
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 8px;
                    line-height: 1.4;
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
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                }
                
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                
                .help {
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
                    margin-top: 8px;
                    line-height: 1.3;
                }
            </style>
        </head>
        <body>
            <div class="info">
                Registers your mode-manager-mcp server with VS Code's built-in MCP system.
            </div>
            
            <button onclick="sendMessage('start')">Register Server</button>
            <button onclick="sendMessage('stop')">Unregister Server</button>
            <button onclick="sendMessage('restart')">Restart Server</button>
            <button onclick="sendMessage('tailCopilotLog')">Tail Copilot Log</button>
            
            <div class="help">
                Once registered, Copilot automatically discovers and uses your memory server.
            </div>
            
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

export class CopilotUsagePanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'remember-mcp-usage-panel';

    constructor(private readonly extensionUri: vscode.Uri, private serverManager: McpServerManager) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        // Listen for tree data changes to update the webview
        this.serverManager.onDidChangeTreeData(() => {
            webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
        });

        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.type) {
                case 'clearStats':
                    this.serverManager.clearModelUsageStats();
                    vscode.window.showInformationMessage('Model usage statistics cleared.');
                    break;
                case 'refresh':
                    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
                    break;
            }
        });
    }

    private getHtmlForWebview(webview: vscode.Webview) {
        const usageStats = this.serverManager.getModelUsageStats();
        const totalRequests = Array.from(usageStats.values()).reduce((sum, count) => sum + count, 0);
        const sortedStats = Array.from(usageStats.entries()).sort((a, b) => b[1] - a[1]);

        let tableRows = '';
        if (sortedStats.length === 0) {
            tableRows = '<tr><td colspan="2" class="no-data">No usage data available<br/>Start log tailing to track usage</td></tr>';
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

// Extension activation function
export function activate(context: vscode.ExtensionContext) {
    console.log('Remember MCP extension is now active!');

    // Create server manager
    const serverManager = new McpServerManager();

    
    // Register Copilot Usage panel provider
    const usagePanelProvider = new CopilotUsagePanelProvider(context.extensionUri, serverManager);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(CopilotUsagePanelProvider.viewType, usagePanelProvider)
    );

    // Create tree data provider
    const treeDataProvider = new McpTreeDataProvider(serverManager);
    const treeView = vscode.window.createTreeView('remember-mcp-explorer', {
        treeDataProvider: treeDataProvider,
        showCollapseAll: true
    });
    
    // Force the tree view to reveal and refresh
    setTimeout(() => {
        treeDataProvider.refresh();
        // Just try to make the tree view visible without revealing a specific element
        vscode.commands.executeCommand('workbench.view.extension.remember-mcp-container');
    }, 1000);

    // Register webview panel provider
    const panelProvider = new McpPanelProvider(context.extensionUri, serverManager);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(McpPanelProvider.viewType, panelProvider)
    );

    // Register commands
    const startCommand = vscode.commands.registerCommand('remember-mcp.startServer', async () => {
        await serverManager.startServer();
    });

    const stopCommand = vscode.commands.registerCommand('remember-mcp.stopServer', () => {
        serverManager.stopServer();
    });

    const restartCommand = vscode.commands.registerCommand('remember-mcp.restartServer', async () => {
        await serverManager.restartServer();
    });

    const showPanelCommand = vscode.commands.registerCommand('remember-mcp.showPanel', () => {
        vscode.commands.executeCommand('workbench.view.extension.remember-mcp-container');
    });

    const showOutputCommand = vscode.commands.registerCommand('remember-mcp.showOutput', () => {
        serverManager['outputChannel'].show();
    });

    const clearUsageStatsCommand = vscode.commands.registerCommand('remember-mcp.clearUsageStats', () => {
        serverManager.clearModelUsageStats();
        vscode.window.showInformationMessage('Model usage statistics cleared.');
    });

    // Add all disposables
    context.subscriptions.push(
        serverManager,
        startCommand,
        stopCommand,
        restartCommand,
        showPanelCommand,
        showOutputCommand,
        clearUsageStatsCommand
    );

    // Auto-start server if configured
    const config = vscode.workspace.getConfiguration('remember-mcp');
    if (config.get<boolean>('server.autoStart', true)) {
        setTimeout(async () => {
            await serverManager.startServer();
        }, 2000); // Delay to ensure VS Code is fully loaded
    }

    // Track the current Copilot Chat log tail disposable
    let currentCopilotTail: vscode.Disposable | null = null;
    let copilotTailOutput: vscode.OutputChannel | null = null;

    // Filter for Copilot model summary lines
    function isModelSummaryLine(line: string): boolean {
        return /\[info\] ccreq:.*copilotmd \| success \| .+ \| \d+ms \|/.test(line);
    }

    const tailCopilotLogCmd = vscode.commands.registerCommand('remember-mcp.tailCopilotLog', () => {
        if (currentCopilotTail) {
            vscode.window.showWarningMessage('Copilot Chat log is already being tailed. Stop the current tail before starting a new one.');
            if (copilotTailOutput) {
                copilotTailOutput.show();
            }
            return;
        }
        const myLogDir = context.logUri.fsPath;
        const outputChannel = serverManager['outputChannel'] as vscode.OutputChannel;
        const logPath = McpServerManager.getCopilotChatLogPath(myLogDir, outputChannel);
        if (!logPath) {
            vscode.window.showErrorMessage('Copilot Chat log file not found.');
            return;
        }
        vscode.window.showInformationMessage('Tailing Copilot Chat log: ' + logPath);
        copilotTailOutput = vscode.window.createOutputChannel('Remember MCP Copilot Log');
        copilotTailOutput.show();
        currentCopilotTail = McpServerManager.tailFile(logPath, line => {
            if (copilotTailOutput && isModelSummaryLine(line)) {
                copilotTailOutput.appendLine(line);
                // Track model usage
                const modelName = McpServerManager.extractModelFromLogLine(line);
                if (modelName) {
                    serverManager.recordModelUsage(modelName);
                }
            }
        });
        context.subscriptions.push({
            dispose: () => {
                if (currentCopilotTail) {
                    currentCopilotTail.dispose();
                }
                currentCopilotTail = null;
                if (copilotTailOutput) {
                    copilotTailOutput.dispose();
                    copilotTailOutput = null;
                }
            }
        });
    });
    context.subscriptions.push(tailCopilotLogCmd);

    // Dispose the tail on deactivate
    context.subscriptions.push({
        dispose: () => {
            if (currentCopilotTail) {
                currentCopilotTail.dispose();
            }
            currentCopilotTail = null;
            if (copilotTailOutput) {
                copilotTailOutput.dispose();
                copilotTailOutput = null;
            }
        }
    });
}

export function deactivate() {}
