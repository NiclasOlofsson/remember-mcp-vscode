import * as vscode from 'vscode';

/**
 * ForceFileWatcher wraps a VS Code FileSystemWatcher and adds periodic forced checks
 * to catch delayed writes or missed events. It does NOT subclass FileSystemWatcher,
 * but exposes a similar API and can be used as a drop-in replacement for most use cases.
 */
export class ForceFileWatcher {
    private watcher: vscode.FileSystemWatcher;
    private forceFlushTimer?: NodeJS.Timeout;
    private isWatching = false;
    private callbacks: Array<(uri: vscode.Uri) => void> = [];
    private lastForcedState: Map<string, any> = new Map();

    /**
     * @param globPattern Glob pattern for files to watch
     * @param forceFlushIntervalMs Interval for forced checks (ms)
     * @param onForceFlush Optional callback for forced check events
     * @param ignoreCreateEvents Ignore create events
     * @param ignoreChangeEvents Ignore change events
     * @param ignoreDeleteEvents Ignore delete events
     */
    /**
     * @param globPattern Glob pattern for files to watch
     * @param forceFlushIntervalMs Interval for forced checks (ms)
     * @param forcedCheckFn Optional function to perform forced file check. Should return a value representing file state (e.g., mtime, hash, contents)
     * @param onForceFlush Optional callback for forced check events
     * @param ignoreCreateEvents Ignore create events
     * @param ignoreChangeEvents Ignore change events
     * @param ignoreDeleteEvents Ignore delete events
     */
    private globPattern: vscode.GlobPattern;
    constructor(
        globPattern: vscode.GlobPattern,
        private forceFlushIntervalMs: number = 2000,
        private forcedCheckFn?: (uri: vscode.Uri) => Promise<any>,
        private onForceFlush?: () => void,
        ignoreCreateEvents?: boolean,
        ignoreChangeEvents?: boolean,
        ignoreDeleteEvents?: boolean
    ) {
        this.globPattern = globPattern;
        this.watcher = vscode.workspace.createFileSystemWatcher(
            globPattern,
            ignoreCreateEvents,
            ignoreChangeEvents,
            ignoreDeleteEvents
        );
    }

    /**
     * Start watching and begin periodic forced checks
     */
    start(): void {
        if (this.isWatching) {
            return;
        }
        this.isWatching = true;
        // Start periodic forced checks
        if (this.forceFlushIntervalMs > 0) {
            this.forceFlushTimer = setInterval(async () => {
                if (this.onForceFlush) {
                    this.onForceFlush();
                }
                if (this.forcedCheckFn) {
                    // Get all files matching the glob pattern
                    const files = await vscode.workspace.findFiles(this.globPattern);
                    for (const uri of files) {
                        try {
                            const state = await this.forcedCheckFn(uri);
                            const lastState = this.lastForcedState.get(uri.toString());
                            if (lastState !== undefined && state !== lastState) {
                                // Trigger change event if state differs
                                this.callbacks.forEach(cb => cb(uri));
                            }
                            this.lastForcedState.set(uri.toString(), state);
                        } catch (err) {
                            // Ignore errors for missing files, etc.
                        }
                    }
                }
            }, this.forceFlushIntervalMs);
        }
    }

    /**
     * Stop watching and clear forced check timer
     */
    stop(): void {
        if (this.forceFlushTimer) {
            clearInterval(this.forceFlushTimer);
            this.forceFlushTimer = undefined;
        }
        this.isWatching = false;
    }

    /**
     * Dispose watcher and timer
     */
    dispose(): void {
        this.stop();
        this.watcher.dispose();
        this.callbacks = [];
    }

    /**
     * Subscribe to file change events
     */
    onDidChange(callback: (uri: vscode.Uri) => void): void {
        this.watcher.onDidChange(callback);
        this.callbacks.push(callback);
    }

    onDidCreate(callback: (uri: vscode.Uri) => void): void {
        this.watcher.onDidCreate(callback);
        this.callbacks.push(callback);
    }

    onDidDelete(callback: (uri: vscode.Uri) => void): void {
        this.watcher.onDidDelete(callback);
        this.callbacks.push(callback);
    }

    /**
     * Get watching status
     */
    getStatus(): { isWatching: boolean; callbackCount: number; interval: number } {
        return {
            isWatching: this.isWatching,
            callbackCount: this.callbacks.length,
            interval: this.forceFlushIntervalMs
        };
    }
}
