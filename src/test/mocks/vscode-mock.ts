/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Niclas Olofsson. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * Mock implementation of VS Code API for testing
 */

export const workspace = {
	getConfiguration: () => ({
		get: () => undefined,
		update: () => Promise.resolve(),
	}),
	workspaceFolders: [],
	onDidChangeConfiguration: () => ({ dispose: () => {} }),
};

export const window = {
	showErrorMessage: () => Promise.resolve(),
	showWarningMessage: () => Promise.resolve(),
	showInformationMessage: () => Promise.resolve(),
	createOutputChannel: () => ({
		appendLine: () => {},
		show: () => {},
		dispose: () => {},
	}),
};

export const commands = {
	registerCommand: () => ({ dispose: () => {} }),
	executeCommand: () => Promise.resolve(),
};

export const ExtensionContext = {
	subscriptions: [],
	globalState: {
		get: () => undefined,
		update: () => Promise.resolve(),
	},
	workspaceState: {
		get: () => undefined,
		update: () => Promise.resolve(),
	},
};

export const Disposable = {
	from: () => ({ dispose: () => {} }),
};

export const Uri = {
	file: (path: string) => ({ fsPath: path }),
	parse: (uri: string) => ({ fsPath: uri }),
};

// Extension lifecycle
export function activate() {}
export function deactivate() {}
