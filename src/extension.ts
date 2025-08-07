import * as vscode from 'vscode';

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Prerequisite checker for Python and pipx
export class PrerequisiteChecker {
    private static cachedResult: { python: boolean; pipx: boolean; pythonVersion?: string; autoInstallAttempted?: boolean } | null = null;

    static async checkPrerequisites(): Promise<{ python: boolean; pipx: boolean; pythonVersion?: string; autoInstallAttempted?: boolean }> {
        if (this.cachedResult) {
            return this.cachedResult;
        }

        const results = { python: false, pipx: false, pythonVersion: undefined as string | undefined, autoInstallAttempted: false };

        // Check Python and get version
        let pythonCommand = '';
        try {
            const result = await execAsync('python --version');
            results.python = true;
            results.pythonVersion = result.stdout.trim();
            pythonCommand = 'python';
        } catch {
            try {
                const result = await execAsync('python3 --version');
                results.python = true;
                results.pythonVersion = result.stdout.trim();
                pythonCommand = 'python3';
            } catch {
                // Python not found
            }
        }

        // Check pipx
        try {
            if (results.python) {
                await execAsync('pipx --version');
                results.pipx = true;
            }
        } catch {
            // pipx not found
        }

        this.cachedResult = results;
        return results;
    }

    static async installPipx(outputChannel?: vscode.OutputChannel): Promise<boolean> {
        const debug = (msg: string) => {
            if (outputChannel) {
                outputChannel.appendLine(`[PIPX INSTALL] ${msg}`);
            }
        };

        try {
            // First check if we have Python and get the command
            let pythonCommand = '';
            let pythonVersion = '';
            
            try {
                const result = await execAsync('python --version');
                pythonCommand = 'python';
                pythonVersion = result.stdout.trim();
            } catch {
                try {
                    const result = await execAsync('python3 --version');
                    pythonCommand = 'python3';
                    pythonVersion = result.stdout.trim();
                } catch {
                    debug('Python not found - cannot install pipx');
                    return false;
                }
            }

            debug(`Found ${pythonVersion} using command: ${pythonCommand}`);

            // Check if Python version is 3.10 or higher
            const versionMatch = pythonVersion.match(/Python (\d+)\.(\d+)/);
            if (!versionMatch) {
                debug('Could not parse Python version');
                return false;
            }

            const majorVersion = parseInt(versionMatch[1]);
            const minorVersion = parseInt(versionMatch[2]);
            
            if (majorVersion < 3 || (majorVersion === 3 && minorVersion < 10)) {
                debug(`Python ${majorVersion}.${minorVersion} is below required 3.10+ - not installing pipx automatically`);
                return false;
            }

            debug(`Python ${majorVersion}.${minorVersion} meets requirements - installing pipx...`);

            // Install pipx
            const installCommand = process.platform === 'win32' 
                ? `${pythonCommand} -m pip install --user pipx`
                : `${pythonCommand} -m pip install --user pipx`;
            
            debug(`Running: ${installCommand}`);
            await execAsync(installCommand);
            debug('pipx installation completed');

            // Setup pipx path
            const ensurePathCommand = process.platform === 'win32'
                ? 'pipx ensurepath'
                : `${pythonCommand} -m pipx ensurepath`;
            
            debug(`Running: ${ensurePathCommand}`);
            try {
                await execAsync(ensurePathCommand);
                debug('pipx ensurepath completed');
            } catch (error) {
                debug(`pipx ensurepath failed (may be normal): ${error}`);
                // This might fail if pipx is not yet in PATH, which is expected
            }

            // Verify installation
            try {
                await execAsync('pipx --version');
                debug('pipx installation verified successfully');
                return true;
            } catch {
                debug('pipx installation verification failed - may need PATH refresh');
                return false;
            }

        } catch (error) {
            debug(`pipx installation failed: ${error}`);
            return false;
        }
    }

    static clearCache(): void {
        this.cachedResult = null;
    }
}

// Data layer for managing usage statistics
export class UsageStatsManager {
    private usageStats: Map<string, number> = new Map();
    private _onDidChangeStats: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeStats: vscode.Event<void> = this._onDidChangeStats.event;

    recordUsage(modelName: string): void {
        const currentCount = this.usageStats.get(modelName) || 0;
        this.usageStats.set(modelName, currentCount + 1);
        this._onDidChangeStats.fire();
    }

    getStats(): Map<string, number> {
        return new Map(this.usageStats);
    }

    clearStats(): void {
        this.usageStats.clear();
        this._onDidChangeStats.fire();
    }

    dispose(): void {
        this._onDidChangeStats.dispose();
    }
}

export class RememberMcpManager {
    private outputChannel: vscode.OutputChannel;
    private statusBarItem: vscode.StatusBarItem;
    private mcpProvider: vscode.Disposable | null = null;
    public readonly usageStatsManager: UsageStatsManager;
    
    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Remember MCP');
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.command = 'remember-mcp.showPanel';
        this.usageStatsManager = new UsageStatsManager();
        this.updateStatusBar('stopped');
        this.statusBarItem.show();
    }

    /**
     * Utility: Get the Copilot Chat extension's log file path by navigating from our globalStoragePath.
     * @param myLogDir Your extension's globalStoragePath
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
     * Uses polling-based file watching for reliable cross-platform operation.
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
        this.usageStatsManager.recordUsage(modelName);
    }

    /**
     * Get current model usage statistics
     * @returns Map of model names to usage counts
     */
    getModelUsageStats(): Map<string, number> {
        return this.usageStatsManager.getStats();
    }

    /**
     * Clear all model usage statistics
     */
    clearModelUsageStats(): void {
        this.usageStatsManager.clearStats();
    }

    private updateStatusBar(status: 'running' | 'stopped' | 'error') {
        switch (status) {
            case 'running':
                this.statusBarItem.text = '$(server) Remember MCP Running';
                this.statusBarItem.backgroundColor = undefined;
                vscode.commands.executeCommand('setContext', 'remember-mcp:enabled', true);
                break;
            case 'stopped':
                this.statusBarItem.text = '$(server) Remember MCP Stopped';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                vscode.commands.executeCommand('setContext', 'remember-mcp:enabled', false);
                break;
            case 'error':
                this.statusBarItem.text = '$(error) Remember MCP Error';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                vscode.commands.executeCommand('setContext', 'remember-mcp:enabled', false);
                break;
        }
    }

    async startServer(): Promise<void> {
        if (this.mcpProvider) {
            this.outputChannel.appendLine('Remember MCP Server is already running');
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
            vscode.window.showWarningMessage('MCP is disabled in VS Code settings. Enable "chat.mcp.enabled" to use the Remember MCP Server.');
            this.updateStatusBar('error');
            return;
        }
        
        this.outputChannel.appendLine(`Registering Remember MCP Server with command: ${serverCommand}`);
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
            this.outputChannel.appendLine('Remember MCP Server provider registered successfully');
            vscode.window.showInformationMessage('Remember MCP Server registered with VS Code');

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
            this.outputChannel.appendLine(`Failed to register Remember MCP Server: ${error}`);
            this.updateStatusBar('error');
            vscode.window.showErrorMessage(`Failed to register Remember MCP Server: ${error}`);
        }
    }

    stopServer(): void {
        if (!this.mcpProvider) {
            this.outputChannel.appendLine('Remember MCP Server provider is not registered');
            return;
        }

        this.outputChannel.appendLine('Unregistering Remember MCP Server provider...');
        this.mcpProvider.dispose();
        this.mcpProvider = null;
        this.updateStatusBar('stopped');
        this.outputChannel.appendLine('Remember MCP Server provider unregistered');
        vscode.window.showInformationMessage('Remember MCP Server unregistered');
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
    }
}

export class RememberMcpPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'remember-mcp-panel';
    private prerequisites: { python: boolean; pipx: boolean; pythonVersion?: string; autoInstallAttempted?: boolean } | null = null;
    private isInstalling = false;

    constructor(private readonly extensionUri: vscode.Uri, private rememberManager: RememberMcpManager) {}

    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        // Check prerequisites on startup
        this.prerequisites = await PrerequisiteChecker.checkPrerequisites();
        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.type) {
                case 'start':
                    await this.rememberManager.startServer();
                    break;
                case 'stop':
                    this.rememberManager.stopServer();
                    break;
                case 'restart':
                    this.rememberManager.restartServer();
                    break;
                case 'tailCopilotLog':
                    vscode.commands.executeCommand('remember-mcp.tailCopilotLog');
                    break;
                case 'recheckPrerequisites':
                    PrerequisiteChecker.clearCache();
                    this.prerequisites = await PrerequisiteChecker.checkPrerequisites();
                    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
                    break;
                case 'installPipx':
                    await this.handleInstallPipx(webviewView);
                    break;
            }
        });
    }

    private async handleInstallPipx(webviewView: vscode.WebviewView): Promise<void> {
        if (this.isInstalling) {
            return;
        }

        this.isInstalling = true;
        
        // Update UI to show installation in progress
        webviewView.webview.html = this.getInstallingHtml();
        
        try {
            const outputChannel = this.rememberManager['outputChannel'] as vscode.OutputChannel;
            outputChannel.show();
            outputChannel.appendLine('Starting automatic pipx installation...');
            
            const success = await PrerequisiteChecker.installPipx(outputChannel);
            
            if (success) {
                outputChannel.appendLine('pipx installation completed successfully!');
                vscode.window.showInformationMessage('pipx installed successfully! Please restart VS Code to complete the setup.');
                
                // Mark that we attempted auto-install and clear cache
                PrerequisiteChecker.clearCache();
                this.prerequisites = await PrerequisiteChecker.checkPrerequisites();
                if (this.prerequisites) {
                    this.prerequisites.autoInstallAttempted = true;
                }
            } else {
                outputChannel.appendLine('pipx installation failed. Please install manually.');
                vscode.window.showErrorMessage('pipx installation failed. Please install manually using the instructions below.');
            }
        } catch (error) {
            const outputChannel = this.rememberManager['outputChannel'] as vscode.OutputChannel;
            outputChannel.appendLine(`pipx installation error: ${error}`);
            vscode.window.showErrorMessage('pipx installation failed. Please install manually using the instructions below.');
        } finally {
            this.isInstalling = false;
            webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
        }
    }

    private getHtmlForWebview(webview: vscode.Webview) {
        // Show prerequisite warning if Python or pipx are missing
        if (!this.prerequisites?.python || !this.prerequisites?.pipx) {
            return this.getPrerequisiteWarningHtml();
        }

        return this.getNormalControlHtml();
    }

    private getPrerequisiteWarningHtml() {
        const missingPython = !this.prerequisites?.python;
        const missingPipx = !this.prerequisites?.pipx;
        const pythonVersion = this.prerequisites?.pythonVersion || '';
        
        // Check if Python 3.10+ is available for auto-install
        const canAutoInstallPipx = this.prerequisites?.python && !this.prerequisites?.pipx && !this.prerequisites?.autoInstallAttempted;
        let pythonMajor = 0, pythonMinor = 0;
        if (pythonVersion) {
            const versionMatch = pythonVersion.match(/Python (\d+)\.(\d+)/);
            if (versionMatch) {
                pythonMajor = parseInt(versionMatch[1]);
                pythonMinor = parseInt(versionMatch[2]);
            }
        }
        const pythonVersionOk = pythonMajor > 3 || (pythonMajor === 3 && pythonMinor >= 10);

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
            <title>Prerequisites Required</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-sideBar-background);
                    margin: 0;
                    padding: 20px;
                    line-height: 1.4;
                }
                
                h3 {
                    margin: 0 0 16px 0;
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--vscode-sideBarTitle-foreground);
                }
                
                .warning {
                    background-color: var(--vscode-inputValidation-warningBackground);
                    border: 1px solid var(--vscode-inputValidation-warningBorder);
                    border-radius: 4px;
                    padding: 12px;
                    margin-bottom: 16px;
                }
                
                .info {
                    background-color: var(--vscode-inputValidation-infoBackground);
                    border: 1px solid var(--vscode-inputValidation-infoBorder);
                    border-radius: 4px;
                    padding: 12px;
                    margin-bottom: 16px;
                }
                
                .warning-title, .info-title {
                    font-weight: 600;
                    margin-bottom: 8px;
                    display: flex;
                    align-items: center;
                }
                
                .warning-title {
                    color: var(--vscode-inputValidation-warningForeground);
                }
                
                .info-title {
                    color: var(--vscode-inputValidation-infoForeground);
                }
                
                .warning-icon, .info-icon {
                    margin-right: 6px;
                }
                
                .missing-item {
                    margin: 8px 0;
                    color: var(--vscode-foreground);
                    font-size: 12px;
                }
                
                .missing-item strong {
                    color: var(--vscode-errorForeground);
                }
                
                .found-item {
                    margin: 8px 0;
                    color: var(--vscode-foreground);
                    font-size: 12px;
                }
                
                .found-item strong {
                    color: var(--vscode-inputValidation-infoForeground);
                }
                
                .install-section {
                    margin-top: 16px;
                }
                
                .install-title {
                    font-weight: 600;
                    margin-bottom: 8px;
                    color: var(--vscode-sideBarTitle-foreground);
                }
                
                .install-step {
                    margin: 8px 0;
                    font-size: 12px;
                    color: var(--vscode-foreground);
                }
                
                .install-step-number {
                    display: inline-block;
                    width: 20px;
                    height: 20px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border-radius: 50%;
                    text-align: center;
                    line-height: 20px;
                    font-size: 11px;
                    font-weight: 600;
                    margin-right: 8px;
                }
                
                .code {
                    background-color: var(--vscode-textCodeBlock-background);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 3px;
                    padding: 4px 8px;
                    font-family: var(--vscode-editor-font-family);
                    font-size: 11px;
                    margin: 4px 0;
                    color: var(--vscode-textPreformat-foreground);
                }
                
                .link {
                    color: var(--vscode-textLink-foreground);
                    text-decoration: none;
                    font-size: 12px;
                }
                
                .link:hover {
                    color: var(--vscode-textLink-activeForeground);
                    text-decoration: underline;
                }
                
                button {
                    width: 100%;
                    padding: 6px 12px;
                    margin: 4px 0;
                    border: none;
                    border-radius: 2px;
                    font-size: 12px;
                    cursor: pointer;
                    font-family: var(--vscode-font-family);
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                }
                
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                
                button.primary {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                }
                
                button.secondary {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }
                
                button.secondary:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
                
                .auto-install-section {
                    margin-top: 16px;
                    padding: 12px;
                    background-color: var(--vscode-inputValidation-infoBackground);
                    border: 1px solid var(--vscode-inputValidation-infoBorder);
                    border-radius: 4px;
                }
            </style>
        </head>
        <body>
            <h3>Setup Required</h3>
            
            ${this.prerequisites?.python ? `
            <div class="info">
                <div class="info-title">
                    <span class="info-icon">✅</span>
                    Python Available
                </div>
                <div class="found-item"><strong>Python</strong> is installed: ${pythonVersion}</div>
            </div>
            ` : `
            <div class="warning">
                <div class="warning-title">
                    <span class="warning-icon">⚠️</span>
                    Missing Prerequisites
                </div>
                ${missingPython ? '<div class="missing-item"><strong>Python</strong> is not installed or not in PATH</div>' : ''}
            </div>
            `}
            
            ${!this.prerequisites?.python && missingPython ? `
            <div class="install-section">
                <div class="install-title">Install Python</div>
                <div class="install-step">
                    <span class="install-step-number">1</span>
                    Download Python from <a href="https://www.python.org/downloads/" class="link">python.org</a>
                </div>
                <div class="install-step">
                    <span class="install-step-number">2</span>
                    During installation, check "Add Python to PATH"
                </div>
                <div class="install-step">
                    <span class="install-step-number">3</span>
                    Restart VS Code after installation
                </div>
            </div>
            ` : ''}
            
            ${canAutoInstallPipx && pythonVersionOk ? `
            <div class="auto-install-section">
                <div class="install-title">🚀 Automatic Installation Available</div>
                <div class="install-step">
                    We can automatically install pipx for you using your existing ${pythonVersion}!
                </div>
                <button class="primary" onclick="sendMessage('installPipx')">Install pipx Automatically</button>
            </div>
            ` : ''}
            
            ${canAutoInstallPipx && !pythonVersionOk ? `
            <div class="warning">
                <div class="warning-title">
                    <span class="warning-icon">⚠️</span>
                    Python Version Too Old
                </div>
                <div class="missing-item">Automatic pipx installation requires Python 3.10+, but you have ${pythonVersion}</div>
            </div>
            ` : ''}
            
            ${(!canAutoInstallPipx && missingPipx && this.prerequisites?.python) || this.prerequisites?.autoInstallAttempted ? `
            <div class="install-section">
                <div class="install-title">Install pipx Manually</div>
                <div class="install-step">
                    <span class="install-step-number">1</span>
                    Open a terminal and run:
                    <div class="code">python -m pip install --user pipx</div>
                </div>
                <div class="install-step">
                    <span class="install-step-number">2</span>
                    Add pipx to PATH:
                    <div class="code">python -m pipx ensurepath</div>
                </div>
                <div class="install-step">
                    <span class="install-step-number">3</span>
                    Restart VS Code
                </div>
            </div>
            ` : ''}
            
            <button class="secondary" onclick="sendMessage('recheckPrerequisites')">Check Again</button>
            
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

    private getInstallingHtml() {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
            <title>Installing pipx</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-sideBar-background);
                    margin: 0;
                    padding: 20px;
                    line-height: 1.4;
                    text-align: center;
                }
                
                h3 {
                    margin: 0 0 16px 0;
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--vscode-sideBarTitle-foreground);
                }
                
                .installing {
                    background-color: var(--vscode-inputValidation-infoBackground);
                    border: 1px solid var(--vscode-inputValidation-infoBorder);
                    border-radius: 4px;
                    padding: 20px;
                    margin: 20px 0;
                }
                
                .spinner {
                    display: inline-block;
                    width: 20px;
                    height: 20px;
                    border: 2px solid var(--vscode-inputValidation-infoBorder);
                    border-radius: 50%;
                    border-top-color: var(--vscode-inputValidation-infoForeground);
                    animation: spin 1s ease-in-out infinite;
                    margin-right: 8px;
                }
                
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
                
                .install-message {
                    color: var(--vscode-inputValidation-infoForeground);
                    font-weight: 600;
                    margin-bottom: 8px;
                }
                
                .install-details {
                    color: var(--vscode-foreground);
                    font-size: 12px;
                }
            </style>
        </head>
        <body>
            <h3>Installing pipx</h3>
            
            <div class="installing">
                <div class="install-message">
                    <span class="spinner"></span>
                    Installing pipx automatically...
                </div>
                <div class="install-details">
                    This may take a minute. Check the output panel for progress.
                </div>
            </div>
        </body>
        </html>`;
    }

    private getNormalControlHtml() {
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

export class RememberMcpUsagePanelProvider implements vscode.WebviewViewProvider {
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

    // Check prerequisites on startup
    PrerequisiteChecker.checkPrerequisites().then(prerequisites => {
        if (!prerequisites.python || !prerequisites.pipx) {
            const missing = [];
            if (!prerequisites.python) {
                missing.push('Python');
            }
            if (!prerequisites.pipx) {
                missing.push('pipx');
            }
            
            // Show different messages based on whether auto-install is available
            let message = `Remember MCP requires ${missing.join(' and ')} to be installed.`;
            if (prerequisites.python && !prerequisites.pipx && prerequisites.pythonVersion) {
                const versionMatch = prerequisites.pythonVersion.match(/Python (\d+)\.(\d+)/);
                if (versionMatch) {
                    const majorVersion = parseInt(versionMatch[1]);
                    const minorVersion = parseInt(versionMatch[2]);
                    if (majorVersion > 3 || (majorVersion === 3 && minorVersion >= 10)) {
                        message += ' We can install pipx automatically for you.';
                    }
                }
            }
            message += ' Check the Server Control panel for installation options.';
            
            vscode.window.showWarningMessage(message, 'Show Panel').then(choice => {
                if (choice === 'Show Panel') {
                    vscode.commands.executeCommand('workbench.view.extension.remember-mcp-container');
                }
            });
        }
    });

    // Create Remember MCP manager
    const rememberManager = new RememberMcpManager();

    // Register Copilot Usage panel provider
    const usagePanelProvider = new RememberMcpUsagePanelProvider(context.extensionUri, rememberManager);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(RememberMcpUsagePanelProvider.viewType, usagePanelProvider)
    );

    // Register webview panel provider
    const panelProvider = new RememberMcpPanelProvider(context.extensionUri, rememberManager);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(RememberMcpPanelProvider.viewType, panelProvider)
    );

    // Register commands
    const startCommand = vscode.commands.registerCommand('remember-mcp.startServer', async () => {
        await rememberManager.startServer();
    });

    const stopCommand = vscode.commands.registerCommand('remember-mcp.stopServer', () => {
        rememberManager.stopServer();
    });

    const restartCommand = vscode.commands.registerCommand('remember-mcp.restartServer', async () => {
        await rememberManager.restartServer();
    });

    const showPanelCommand = vscode.commands.registerCommand('remember-mcp.showPanel', () => {
        vscode.commands.executeCommand('workbench.view.extension.remember-mcp-container');
    });

    const showOutputCommand = vscode.commands.registerCommand('remember-mcp.showOutput', () => {
        rememberManager['outputChannel'].show();
    });

    const clearUsageStatsCommand = vscode.commands.registerCommand('remember-mcp.clearUsageStats', () => {
        rememberManager.clearModelUsageStats();
        vscode.window.showInformationMessage('Model usage statistics cleared.');
    });

    // Add all disposables
    context.subscriptions.push(
        rememberManager,
        startCommand,
        stopCommand,
        restartCommand,
        showPanelCommand,
        showOutputCommand,
        clearUsageStatsCommand
    );

    // Auto-start MCP server if configured
    const config = vscode.workspace.getConfiguration('remember-mcp');
    if (config.get<boolean>('server.autoStart', true)) {
        setTimeout(async () => {
            await rememberManager.startServer();
        }, 2000); // Delay to ensure VS Code is fully loaded
    }

    // Track the current Copilot Chat log tail disposable and poller globally in the extension
    let currentCopilotTail: vscode.Disposable | null = null;
    let copilotTailOutput: vscode.OutputChannel | null = null;
    let copilotTailPoller: NodeJS.Timeout | null = null;

    // Read polling interval from settings (default 10000 ms)
    function getTailPollInterval(): number {
        const config = vscode.workspace.getConfiguration('remember-mcp');
        const interval = config.get<number>('tail.pollInterval', 10000);
        // Clamp to minimum 1000 ms for safety
        return Math.max(1000, interval);
    }

    // Filter for Copilot model summary lines
    function isModelSummaryLine(line: string): boolean {
        return /\[info\] ccreq:.*copilotmd \| success \| .+ \| \d+ms \|/.test(line);
    }

    // Shared function to start tailing or polling for the log file
    function startCopilotLogTail() {
        if (currentCopilotTail || copilotTailPoller) {
            // Already running
            return;
        }
        const myLogDir = context.logUri.fsPath;
        const outputChannel = rememberManager['outputChannel'] as vscode.OutputChannel;
        let logPath = RememberMcpManager.getCopilotChatLogPath(myLogDir, outputChannel);
        copilotTailOutput = vscode.window.createOutputChannel('Remember MCP Copilot Log');
        copilotTailOutput.show();

        function startTailing(pathToLog: string) {
            // Log to output channel instead of showing notification
            outputChannel.appendLine(`Starting to tail Copilot Chat log: ${pathToLog}`);
            currentCopilotTail = RememberMcpManager.tailFile(pathToLog, line => {
                if (copilotTailOutput && isModelSummaryLine(line)) {
                    copilotTailOutput.appendLine(line);
                    // Track model usage
                    const modelName = RememberMcpManager.extractModelFromLogLine(line);
                    if (modelName) {
                        rememberManager.recordModelUsage(modelName);
                    }
                }
            });
        }

        const pollInterval = getTailPollInterval();
        if (logPath) {
            startTailing(logPath);
        } else {
            // Log to output channel instead of showing warning notification
            outputChannel.appendLine(`Copilot Chat log file not found. Will poll every ${pollInterval / 1000} seconds until it appears.`);
            copilotTailPoller = setInterval(() => {
                logPath = RememberMcpManager.getCopilotChatLogPath(myLogDir, outputChannel);
                if (logPath) {
                    if (copilotTailPoller) {
                        clearInterval(copilotTailPoller);
                        copilotTailPoller = null;
                    }
                    startTailing(logPath);
                }
            }, pollInterval);
        }
    }

    // Manual command to start tailing
    const tailCopilotLogCmd = vscode.commands.registerCommand('remember-mcp.tailCopilotLog', () => {
        if (currentCopilotTail || copilotTailPoller) {
            // Log to output channel instead of showing warning notification
            const outputChannel = rememberManager['outputChannel'] as vscode.OutputChannel;
            outputChannel.appendLine('Copilot Chat log is already being tailed or polling. Stop the current tail before starting a new one.');
            if (copilotTailOutput) {
                copilotTailOutput.show();
            }
            return;
        }
        startCopilotLogTail();
    });
    context.subscriptions.push(tailCopilotLogCmd);

    // Automatically start tailing on extension activation
    startCopilotLogTail();

    // Dispose the tail and poller on deactivate
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
            if (copilotTailPoller) {
                clearInterval(copilotTailPoller);
                copilotTailPoller = null;
            }
        }
    });
}

export function deactivate() {}
