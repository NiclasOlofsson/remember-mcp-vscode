import * as vscode from 'vscode';

import { exec } from 'child_process';
import { promisify } from 'util';
import { CopilotUsageHistoryPanel } from './webview/copilot-usage-history-panel/index';
import { ServerControlPanel } from './webview/server-control-panel/index';
import { CopilotUsagePanel } from './webview/copilot-usage-panel';
import { UnifiedSessionDataService } from './storage/unified-session-data-service';
import { VSCodeLogger, ILogger } from './types/logger';
import { ServiceContainer } from './types/service-container';

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
		try {
			const result = await execAsync('python --version');
			results.python = true;
			results.pythonVersion = result.stdout.trim();
		} catch {
			try {
				const result = await execAsync('python3 --version');
				results.python = true;
				results.pythonVersion = result.stdout.trim();
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

	static async installPipx(logger?: ILogger): Promise<boolean> {
		const debug = (msg: string) => {
			if (logger) {
				logger.debug(msg);
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
	private statusBarItem: vscode.StatusBarItem;
	private mcpProvider: vscode.Disposable | null = null;
	public readonly usageStatsManager: UsageStatsManager;
	private unifiedDataService?: UnifiedSessionDataService;
    
	constructor(
		private readonly context: vscode.ExtensionContext, 
		private readonly outputChannel: vscode.LogOutputChannel,
		private readonly logger: ILogger
	) {
		this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this.statusBarItem.command = 'remember-mcp.showPanel';
		this.usageStatsManager = new UsageStatsManager();
		this.updateStatusBar('stopped');
		this.statusBarItem.show();
        
		// Get unified data service from service container
		if (this.context) {
			this.initializeUnifiedDataService();
		}
	}

	/**
     * Initialize the unified data service for real-time log monitoring
     * Uses the service container to get the shared instance
     */
	private async initializeUnifiedDataService(): Promise<void> {
		if (!this.context) {
			return;
		}

		try {
			// Get the shared service instance from the container
			if (ServiceContainer.isInitialized()) {
				this.unifiedDataService = ServiceContainer.getInstance().getUnifiedSessionDataService();
			} else {
				this.logger.warn('WARNING: ServiceContainer not initialized, cannot get shared service');
				return;
			}
			
			// Initialize the service if not already initialized
			await this.unifiedDataService.initialize();
			this.logger.info('Connected to shared unified data service for usage tracking');
		} catch (error) {
			this.logger.error(`Failed to connect to unified data service: ${error}`);
		}
	}

	// Legacy static methods removed - all log handling now done through UnifiedSessionDataService

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

	/**
     * Get the unified data service instance
     * @returns UnifiedSessionDataService instance or undefined if not initialized
     */
	getUnifiedDataService(): UnifiedSessionDataService | undefined {
		return this.unifiedDataService;
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
			this.logger.info('Remember MCP Server is already running');
			return;
		}

		const config = vscode.workspace.getConfiguration('remember-mcp');
		const serverCommand = config.get<string>('server.command', 'pipx run mode-manager-mcp');
        
		// Check VS Code MCP settings
		const chatConfig = vscode.workspace.getConfiguration('chat');
		const mcpEnabled = chatConfig.get('mcp.enabled');
		this.logger.debug(`VS Code chat.mcp.enabled setting: ${mcpEnabled}`);
        
		if (mcpEnabled === false) {
			this.logger.warn('WARNING: MCP is disabled in VS Code settings');
			vscode.window.showWarningMessage('MCP is disabled in VS Code settings. Enable "chat.mcp.enabled" to use the Remember MCP Server.');
			this.updateStatusBar('error');
			return;
		}
        
		this.logger.info(`Registering Remember MCP Server with command: ${serverCommand}`);

		try {
			// Parse command and arguments
			const [command, ...args] = serverCommand.split(' ');
            
			this.logger.debug(`Command: ${command}`);
			this.logger.debug(`Arguments: ${JSON.stringify(args)}`);
            
			// Register the MCP server using the official VS Code MCP API
			this.mcpProvider = vscode.lm.registerMcpServerDefinitionProvider('remember-mcp-provider', {
				provideMcpServerDefinitions: async () => {
					this.logger.debug('Providing MCP server definition');
					const serverDef = new vscode.McpStdioServerDefinition(
						'Remember MCP (Mode Manager)',
						command,
						args,
						{}, // environment variables
						'1.0.0' // version
					);
					this.logger.debug(`Server definition created for command: ${command}`);
					return [serverDef];
				},
				resolveMcpServerDefinition: async (server) => {
					this.logger.debug(`Resolving MCP server definition for: ${command}`);
					return server;
				}
			});

			this.updateStatusBar('running');
			this.logger.info('Remember MCP Server provider registered successfully');
			vscode.window.showInformationMessage('Remember MCP Server registered with VS Code');

			// Check for available tools after a short delay
			setTimeout(() => {
				const tools = vscode.lm.tools;
				this.logger.debug(`Available LM tools: ${tools.length}`);
				if (tools.length > 0) {
					this.logger.debug(`Tool names: ${tools.map(t => t.name).join(', ')}`);
				} else {
					this.logger.debug('No tools are currently available to VS Code');
				}
			}, 3000);

		} catch (error) {
			this.logger.error(`Failed to register Remember MCP Server: ${error}`);
			this.updateStatusBar('error');
			vscode.window.showErrorMessage(`Failed to register Remember MCP Server: ${error}`);
		}
	}

	stopServer(): void {
		if (!this.mcpProvider) {
			this.logger.debug('Remember MCP Server provider is not registered');
			return;
		}

		this.logger.info('Unregistering Remember MCP Server provider...');
		this.mcpProvider.dispose();
		this.mcpProvider = null;
		this.updateStatusBar('stopped');
		this.logger.info('Remember MCP Server provider unregistered');
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
		if (this.unifiedDataService) {
			this.unifiedDataService.dispose();
		}
		this.usageStatsManager.dispose();
		// Note: outputChannel disposal is handled by the extension context
		this.statusBarItem.dispose();
	}
}


// Extension activation function
export function activate(context: vscode.ExtensionContext) {
	console.log('Remember MCP extension is now active!');
    
	// Show immediate debug message
	vscode.window.showInformationMessage('Remember MCP Extension Activated!');

	// Initialize the service container early - this ensures single instances
	const logChannel = vscode.window.createOutputChannel('Remember MCP', { log: true });
	const logger = new VSCodeLogger(logChannel);
	const serviceContainer = ServiceContainer.initialize({
		extensionContext: context,
		logger,
		extensionVersion: context.extension.packageJSON.version,
		sessionDataServiceOptions: {
			enableRealTimeUpdates: true,
			enableLogScanning: true,
			debounceMs: 500
		}
	});

	// Dispose service container when extension is deactivated
	context.subscriptions.push({
		dispose: () => serviceContainer.dispose()
	});

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

	// Create Remember MCP manager with context for unified data service and shared output channel
	const rememberManager = new RememberMcpManager(context, logChannel, logger);

	// Register Copilot Usage panel provider
	const usagePanelProvider = new CopilotUsagePanel(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(CopilotUsagePanel.viewType, usagePanelProvider)
	);

	// Register enhanced Copilot Usage History panel provider
	const usageHistoryPanelProvider = new CopilotUsageHistoryPanel(context.extensionUri, context, logger);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(CopilotUsageHistoryPanel.viewType, usageHistoryPanelProvider)
	);

	// Register webview panel provider
	const panelProvider = new ServerControlPanel(context.extensionUri, rememberManager, logger);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ServerControlPanel.viewType, panelProvider)
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

	// Add Copilot Usage History commands
	const showUsageHistoryCommand = vscode.commands.registerCommand('remember-mcp.showUsageHistory', () => {
		vscode.commands.executeCommand('workbench.view.extension.remember-mcp-container');
	});

	const clearUsageHistoryCommand = vscode.commands.registerCommand('remember-mcp.clearUsageHistory', async () => {
		try {
			const result = await vscode.window.showWarningMessage(
				'Are you sure you want to clear all Copilot usage history? This action cannot be undone.',
				{ modal: true },
				'Yes, Clear All'
			);

			if (result === 'Yes, Clear All') {
				await usageHistoryPanelProvider.clearStorage();
				vscode.window.showInformationMessage('Copilot usage history cleared successfully.');
			}
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to clear usage history: ${error}`);
		}
	});



	// Add all disposables
	context.subscriptions.push(
		logChannel, // Dispose shared log channel
		rememberManager,
		startCommand,
		stopCommand,
		restartCommand,
		showPanelCommand,
		showOutputCommand,
		clearUsageStatsCommand,
		showUsageHistoryCommand,
		clearUsageHistoryCommand
	);

	// Auto-start MCP server if configured
	const config = vscode.workspace.getConfiguration('remember-mcp');
	if (config.get<boolean>('server.autoStart', true)) {
		setTimeout(async () => {
			await rememberManager.startServer();
		}, 2000); // Delay to ensure VS Code is fully loaded
	}

	// Add debug command to inspect session content using only the unified layer
	const debugLogCommand = vscode.commands.registerCommand('remember-mcp.debugLogContent', async () => {
		// const outputChannel = rememberManager['outputChannel'] as vscode.LogOutputChannel;
        
		try {
			// Use the shared service instance from the container
			const sessionService = ServiceContainer.getInstance().getUnifiedSessionDataService();
            
			const { sessionEvents, logEntries, stats } = await sessionService.initialize();
			logger.info(`Found ${sessionEvents.length} session events and ${logEntries.length} log entries from ${stats.totalSessions} sessions.`);
            
			if (sessionEvents.length > 0) {
				logger.info('Sample session events:');
				sessionEvents.slice(0, 5).forEach((event: any, index: number) => {
					logger.info(`  ${index + 1}: ${event.type} at ${event.timestamp} (${event.model || 'unknown model'})`);
				});
			} else {
				logger.info('No session events found.');
			}
            
			if (logEntries.length > 0) {
				logger.info('Sample log entries:');
				logEntries.slice(0, 3).forEach((entry: any, index: number) => {
					logger.info(`  ${index + 1}: ${entry.status} at ${entry.timestamp} (${entry.modelName})`);
				});
			} else {
				logger.info('No log entries found.');
			}
		} catch (error) {
			logger.error(`Session debugging failed: ${error}`);
		}
		// Note: No need to dispose shared service instance
	});

	// Add to subscriptions
	context.subscriptions.push(debugLogCommand);
    
	// Dispose usage history panel on deactivate
	context.subscriptions.push({
		dispose: () => {
			// Dispose usage history panel
			usageHistoryPanelProvider.dispose();
		}
	});
}

export function deactivate() {}
