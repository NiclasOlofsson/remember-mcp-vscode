import { RememberMcpManager } from '../../extension';

/**
 * Data structure for usage statistics
 */
export interface UsageStats {
    readonly modelUsage: Map<string, number>;
    readonly totalRequests: number;
    readonly sortedStats: [string, number][];
}

/**
 * Model for Copilot Usage Panel
 * Manages data and business logic, provides observable interface
 */
export class CopilotUsageModel {
    private _usageStats: UsageStats | null = null;
    private _listeners: Array<(stats: UsageStats) => void> = [];

    constructor(private readonly rememberManager: RememberMcpManager) {
        // Listen to changes from the remember manager
        this.rememberManager.usageStatsManager.onDidChangeStats(() => {
            this.refreshStats();
        });
        
        // Initialize stats
        this.refreshStats();
    }

    /**
     * Get current usage statistics
     */
    public get usageStats(): UsageStats {
        if (!this._usageStats) {
            this.refreshStats();
        }
        return this._usageStats!;
    }

    /**
     * Subscribe to changes in data
     */
    public onDataChanged(listener: (stats: UsageStats) => void): void {
        this._listeners.push(listener);
    }

    /**
     * Clear all usage statistics
     */
    public clearStats(): void {
        this.rememberManager.clearModelUsageStats();
        this.refreshStats();
    }

    /**
     * Refresh statistics from the data source
     */
    public refreshStats(): void {
        const modelUsage = this.rememberManager.getModelUsageStats();
        const totalRequests = Array.from(modelUsage.values()).reduce((sum: number, count: number) => sum + count, 0);
        const sortedStats = Array.from(modelUsage.entries()).sort((a: [string, number], b: [string, number]) => b[1] - a[1]);

        this._usageStats = {
            modelUsage,
            totalRequests,
            sortedStats
        };

        // Notify all listeners
        this._listeners.forEach(listener => listener(this._usageStats!));
    }

    /**
     * Check if there is any usage data
     */
    public hasData(): boolean {
        return this.usageStats.totalRequests > 0;
    }

    /**
     * Dispose of the model and clean up listeners
     */
    public dispose(): void {
        this._listeners = [];
    }
}
