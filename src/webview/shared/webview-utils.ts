import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Shared webview utilities for consistent styling and functionality
 */
export class WebviewUtils {
	/**
     * Get the shared CSS styles for VS Code panels
     */
	public static async getSharedStyles(extensionUri: vscode.Uri): Promise<string> {
		try {
			const cssPath = path.join(extensionUri.fsPath, 'src', 'webview', 'shared', 'styles', 'panel.css');
			const cssContent = await fs.readFile(cssPath, 'utf8');
			return `<style>${cssContent}</style>`;
		} catch (error) {
			console.warn('Failed to load shared styles, using fallback:', error);
			return '<style>/* Fallback: shared styles not available */</style>';
		}
	}

	/**
     * Get standard webview JavaScript utilities
     */
	public static getSharedScript(): string {
		return `<script>
            const vscode = acquireVsCodeApi();
            
            function sendMessage(type, data = {}) {
                vscode.postMessage({
                    type: type,
                    ...data
                });
            }
        </script>`;
	}

	/**
     * Escape HTML to prevent XSS
     */
	public static escapeHtml(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}
}
