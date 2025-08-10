import * as vscode from 'vscode';

/**
 * Logging interface for dependency injection
 * Allows mocking in tests and different implementations
 */

export interface ILogger {
    appendLine(message: string): void;
}

/**
 * VS Code OutputChannel implementation
 * Shows output channel once per session in development mode to avoid being "needy"
 */
export class VSCodeLogger implements ILogger {
    private hasShownChannel = false;
    
    constructor(
        private readonly outputChannel: vscode.OutputChannel,
        private readonly extensionMode: vscode.ExtensionMode = vscode.ExtensionMode.Production
    ) { }

    appendLine(message: string): void {
        this.outputChannel.appendLine(message);

        // Only auto-show once per session in development mode
        if (this.extensionMode === vscode.ExtensionMode.Development && !this.hasShownChannel) {
            this.outputChannel.show(true); // preserveFocus = true to be less intrusive
            this.hasShownChannel = true;
        }
    }
}

/**
 * Console logger for testing
 */
export class ConsoleLogger implements ILogger {
    appendLine(message: string): void {
        console.log(`[LOG] ${message}`);
    }
}

/**
 * Silent logger for tests that don't need output
 */
export class SilentLogger implements ILogger {
    appendLine(_message: string): void {
        // No-op
    }
}
