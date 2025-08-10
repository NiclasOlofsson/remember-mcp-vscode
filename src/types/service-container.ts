/**
 * Service Container - Dependency injection container for the extension
 * Ensures single instances of services are shared across the extension
 */

import * as vscode from 'vscode';
import { ILogger } from './logger';
import { UnifiedSessionDataService, SessionDataServiceOptions } from '../storage/unified-session-data-service';

export interface ServiceContainerOptions {
    extensionContext: vscode.ExtensionContext;
    logger: ILogger;
    extensionVersion: string;
    sessionDataServiceOptions?: SessionDataServiceOptions;
}

/**
 * Singleton service container that manages all shared services
 */
export class ServiceContainer {
    private static instance: ServiceContainer | null = null;
    
    private _unifiedSessionDataService?: UnifiedSessionDataService;
    
    private constructor(
        private readonly extensionContext: vscode.ExtensionContext,
        private readonly logger: ILogger,
        private readonly extensionVersion: string,
        private readonly sessionDataServiceOptions: SessionDataServiceOptions = {}
    ) {}

    /**
     * Initialize the service container (should be called once from extension activation)
     */
    static initialize(options: ServiceContainerOptions): ServiceContainer {
        if (ServiceContainer.instance) {
            throw new Error('ServiceContainer is already initialized. Use getInstance() instead.');
        }
        
        ServiceContainer.instance = new ServiceContainer(
            options.extensionContext,
            options.logger,
            options.extensionVersion,
            {
                enableRealTimeUpdates: true,
                enableLogScanning: true,
                debounceMs: 500,
                extensionContext: options.extensionContext,
                ...options.sessionDataServiceOptions
            }
        );
        
        return ServiceContainer.instance;
    }

    /**
     * Get the singleton instance (throws if not initialized)
     */
    static getInstance(): ServiceContainer {
        if (!ServiceContainer.instance) {
            throw new Error('ServiceContainer not initialized. Call initialize() first.');
        }
        return ServiceContainer.instance;
    }

    /**
     * Check if the container is initialized
     */
    static isInitialized(): boolean {
        return ServiceContainer.instance !== null;
    }

    /**
     * Get the unified session data service (creates if not exists)
     */
    getUnifiedSessionDataService(): UnifiedSessionDataService {
        if (!this._unifiedSessionDataService) {
            this.logger.appendLine('[ServiceContainer] Creating UnifiedSessionDataService instance');
            this._unifiedSessionDataService = new UnifiedSessionDataService(
                this.logger,
                this.extensionVersion,
                this.sessionDataServiceOptions
            );
        }
        return this._unifiedSessionDataService;
    }

    /**
     * Get the extension context
     */
    getExtensionContext(): vscode.ExtensionContext {
        return this.extensionContext;
    }

    /**
     * Get the logger
     */
    getLogger(): ILogger {
        return this.logger;
    }

    /**
     * Get the extension version
     */
    getExtensionVersion(): string {
        return this.extensionVersion;
    }

    /**
     * Dispose all services and reset the singleton
     */
    dispose(): void {
        this.logger.appendLine('[ServiceContainer] Disposing services');
        
        if (this._unifiedSessionDataService) {
            this._unifiedSessionDataService.dispose();
            this._unifiedSessionDataService = undefined;
        }
        
        ServiceContainer.instance = null;
        this.logger.appendLine('[ServiceContainer] Service container disposed');
    }

    /**
     * Reset the container (for testing)
     */
    static reset(): void {
        if (ServiceContainer.instance) {
            ServiceContainer.instance.dispose();
        }
        ServiceContainer.instance = null;
    }
}
