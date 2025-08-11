import * as vscode from 'vscode';
import { RememberMcpManager } from '../../extension';
import { CopilotUsageModel } from './copilot-usage-model';
import { CopilotUsageView } from './copilot-usage-view';

/**
 * Main panel class that implements WebviewViewProvider
 * Coordinates model and view directly without separate controller
 */
export class CopilotUsagePanel implements vscode.WebviewViewProvider, vscode.Disposable {
	public static readonly viewType = 'remember-mcp-usage-panel';
    
	private _model: CopilotUsageModel | null = null;
	private _view: CopilotUsageView | null = null;
	private _disposables: vscode.Disposable[] = [];

	constructor(
		private readonly extensionUri: vscode.Uri, 
		private readonly rememberManager: RememberMcpManager
	) {}

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

		// Initialize model and view
		this._model = new CopilotUsageModel(this.rememberManager);
		this._view = new CopilotUsageView(webviewView.webview, this.extensionUri);

		// Set up data binding: model changes update the view
		this._model.onDataChanged(async (stats) => {
			await this._view!.render(stats);
		});

		// Handle messages from the webview
		const messageHandler = webviewView.webview.onDidReceiveMessage(async (message) => {
			await this.handleMessage(message);
		});
		this._disposables.push(messageHandler);

		// Initial render
		await this._view.render(this._model.usageStats);
	}

	/**
     * Handle messages from the webview
     */
	private async handleMessage(message: { type: string; [key: string]: any }): Promise<void> {
		if (!this._model) {
			return;
		}

		switch (message.type) {
			case 'clearStats':
				await this.handleClearStats();
				break;
			case 'refresh':
				await this.handleRefresh();
				break;
			default:
				console.warn(`Unknown message type: ${message.type}`);
		}
	}

	/**
     * Handle clear statistics request
     */
	private async handleClearStats(): Promise<void> {
		if (!this._model) {
			return;
		}

		try {
			this._model.clearStats();
			vscode.window.showInformationMessage('Model usage statistics cleared.');
		} catch (error) {
			console.error('Error clearing statistics:', error);
			vscode.window.showErrorMessage('Failed to clear usage statistics.');
		}
	}

	/**
     * Handle refresh request
     */
	private async handleRefresh(): Promise<void> {
		if (!this._model) {
			return;
		}

		try {
			this._model.refreshStats();
		} catch (error) {
			console.error('Error refreshing statistics:', error);
			vscode.window.showErrorMessage('Failed to refresh usage statistics.');
		}
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
