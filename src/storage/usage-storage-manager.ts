/**
 * Enhanced storage manager for Copilot usage events
 * Implements persistent storage with VS Code globalState + file system
 * Based on architecture document specifications
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CopilotUsageEvent, UsageStorageIndex, CopilotUsageSettings, DEFAULT_USAGE_SETTINGS, DateRange, EventFile } from '../types/usage-events';
import { AnalyticsQuery, AnalyticsResult } from '../types/analytics';

export class UsageStorageManager {
    private static readonly STORAGE_KEY = 'copilot-usage-index';
    private static readonly EVENTS_DIR = 'copilot-usage/events';
    
    private context: vscode.ExtensionContext;
    private storageUri: vscode.Uri;
    private eventsDir: vscode.Uri;
    
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.storageUri = context.globalStorageUri;
        this.eventsDir = vscode.Uri.joinPath(this.storageUri, UsageStorageManager.EVENTS_DIR);
    }

    /**
     * Initialize storage structure and load existing index
     */
    async initialize(): Promise<void> {
        // Ensure storage directories exist
        await vscode.workspace.fs.createDirectory(this.storageUri);
        await vscode.workspace.fs.createDirectory(this.eventsDir);
        
        // Load or create storage index
        const index = await this.getStorageIndex();
        if (index.eventFiles.length === 0) {
            // First time setup - scan for any existing event files
            await this.rebuildIndex();
        }
    }

    /**
     * Get the current storage index from globalState
     */
    async getStorageIndex(): Promise<UsageStorageIndex> {
        const stored = this.context.globalState.get<UsageStorageIndex>(UsageStorageManager.STORAGE_KEY);
        
        if (!stored) {
            const defaultIndex: UsageStorageIndex = {
                totalEvents: 0,
                lastUpdate: new Date().toISOString(),
                eventFiles: [],
                settings: DEFAULT_USAGE_SETTINGS
            };
            
            await this.updateStorageIndex(defaultIndex);
            return defaultIndex;
        }
        
        // Ensure settings exist and merge with defaults
        stored.settings = { ...DEFAULT_USAGE_SETTINGS, ...stored.settings };
        return stored;
    }

    /**
     * Update the storage index in globalState
     */
    async updateStorageIndex(index: UsageStorageIndex): Promise<void> {
        await this.context.globalState.update(UsageStorageManager.STORAGE_KEY, index);
    }

    /**
     * Store a single event
     */
    async storeEvent(event: CopilotUsageEvent): Promise<void> {
        const events = [event];
        await this.storeEvents(events);
    }

    /**
     * Store multiple events in batch
     */
    async storeEvents(events: CopilotUsageEvent[]): Promise<void> {
        if (events.length === 0) {
            return;
        }

        // Group events by date for efficient storage
        const eventsByDate = this.groupEventsByDate(events);
        
        for (const [dateKey, dateEvents] of eventsByDate) {
            await this.appendEventsToDateFile(dateKey, dateEvents);
        }

        // Update storage index
        const index = await this.getStorageIndex();
        index.totalEvents += events.length;
        index.lastUpdate = new Date().toISOString();
        await this.updateStorageIndex(index);
    }

    /**
     * Get events for a specific date range
     */
    async getEventsForDateRange(dateRange: DateRange): Promise<CopilotUsageEvent[]> {
        const startDate = new Date(dateRange.start);
        const endDate = new Date(dateRange.end);
        const allEvents: CopilotUsageEvent[] = [];
        
        // Generate list of dates to check
        const dates = this.generateDateRange(startDate, endDate);
        
        for (const date of dates) {
            const dateKey = this.formatDateKey(date);
            const events = await this.getEventsForDate(dateKey);
            
            // Filter events within the time range
            const filteredEvents = events.filter(event => {
                const eventTime = new Date(event.timestamp);
                return eventTime >= startDate && eventTime <= endDate;
            });
            
            allEvents.push(...filteredEvents);
        }
        
        return allEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }

    /**
     * Get all events (use with caution for large datasets)
     */
    async getAllEvents(): Promise<CopilotUsageEvent[]> {
        const index = await this.getStorageIndex();
        const allEvents: CopilotUsageEvent[] = [];
        
        for (const eventFile of index.eventFiles) {
            const events = await this.loadEventFile(eventFile);
            allEvents.push(...events);
        }
        
        return allEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }

    /**
     * Get usage settings
     */
    async getSettings(): Promise<CopilotUsageSettings> {
        const index = await this.getStorageIndex();
        return index.settings;
    }

    /**
     * Update usage settings
     */
    async updateSettings(settings: Partial<CopilotUsageSettings>): Promise<void> {
        const index = await this.getStorageIndex();
        index.settings = { ...index.settings, ...settings };
        await this.updateStorageIndex(index);
    }

    /**
     * Clean up old events based on retention settings
     */
    async cleanupOldEvents(): Promise<{ deletedFiles: number; deletedEvents: number }> {
        const settings = await this.getSettings();
        if (!settings.autoCleanup) {
            return { deletedFiles: 0, deletedEvents: 0 };
        }

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - settings.retentionDays);
        
        const index = await this.getStorageIndex();
        let deletedFiles = 0;
        let deletedEvents = 0;
        
        const remainingFiles: string[] = [];
        
        for (const eventFile of index.eventFiles) {
            const dateKey = path.basename(eventFile, '.json');
            const fileDate = new Date(dateKey);
            
            if (fileDate < cutoffDate) {
                try {
                    const events = await this.loadEventFile(eventFile);
                    deletedEvents += events.length;
                    
                    const fileUri = vscode.Uri.joinPath(this.eventsDir, path.basename(eventFile));
                    await vscode.workspace.fs.delete(fileUri);
                    deletedFiles++;
                } catch (error) {
                    console.error(`Failed to delete event file ${eventFile}:`, error);
                    remainingFiles.push(eventFile);
                }
            } else {
                remainingFiles.push(eventFile);
            }
        }
        
        // Update index
        index.eventFiles = remainingFiles;
        index.totalEvents -= deletedEvents;
        await this.updateStorageIndex(index);
        
        return { deletedFiles, deletedEvents };
    }

    /**
     * Get storage statistics
     */
    async getStorageStats(): Promise<{ totalEvents: number; totalFiles: number; totalSizeBytes: number; oldestEvent?: string; newestEvent?: string }> {
        const index = await this.getStorageIndex();
        let totalSizeBytes = 0;
        let oldestEvent: string | undefined;
        let newestEvent: string | undefined;
        
        for (const eventFile of index.eventFiles) {
            try {
                const fileUri = vscode.Uri.joinPath(this.eventsDir, path.basename(eventFile));
                const stat = await vscode.workspace.fs.stat(fileUri);
                totalSizeBytes += stat.size;
                
                // Check for oldest/newest events
                const events = await this.loadEventFile(eventFile);
                if (events.length > 0) {
                    const firstEvent = events[0].timestamp;
                    const lastEvent = events[events.length - 1].timestamp;
                    
                    if (!oldestEvent || firstEvent < oldestEvent) {
                        oldestEvent = firstEvent;
                    }
                    if (!newestEvent || lastEvent > newestEvent) {
                        newestEvent = lastEvent;
                    }
                }
            } catch (error) {
                console.error(`Failed to stat event file ${eventFile}:`, error);
            }
        }
        
        return {
            totalEvents: index.totalEvents,
            totalFiles: index.eventFiles.length,
            totalSizeBytes,
            oldestEvent,
            newestEvent
        };
    }

    /**
     * Clear all stored events and analytics data (dev feature)
     */
    async clearStorage(): Promise<{ deletedFiles: number; deletedEvents: number }> {
        const index = await this.getStorageIndex();
        let deletedFiles = 0;
        let deletedEvents = index.totalEvents;
        
        // Delete all event files
        for (const eventFile of index.eventFiles) {
            try {
                const fileUri = vscode.Uri.joinPath(this.eventsDir, path.basename(eventFile));
                await vscode.workspace.fs.delete(fileUri);
                deletedFiles++;
            } catch (error) {
                console.error(`Failed to delete event file ${eventFile}:`, error);
            }
        }
        
        // Reset storage index
        const clearedIndex: UsageStorageIndex = {
            totalEvents: 0,
            lastUpdate: new Date().toISOString(),
            eventFiles: [],
            settings: DEFAULT_USAGE_SETTINGS
        };
        
        await this.updateStorageIndex(clearedIndex);
        
        return { deletedFiles, deletedEvents };
    }

    /**
     * Rebuild the storage index by scanning existing files
     */
    private async rebuildIndex(): Promise<void> {
        const files = await this.scanEventFiles();
        let totalEvents = 0;
        
        for (const file of files) {
            const events = await this.loadEventFile(file);
            totalEvents += events.length;
        }
        
        const index: UsageStorageIndex = {
            totalEvents,
            lastUpdate: new Date().toISOString(),
            eventFiles: files,
            settings: DEFAULT_USAGE_SETTINGS
        };
        
        await this.updateStorageIndex(index);
    }

    /**
     * Scan for existing event files in storage
     */
    private async scanEventFiles(): Promise<string[]> {
        try {
            const files = await vscode.workspace.fs.readDirectory(this.eventsDir);
            return files
                .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.json'))
                .map(([name]) => name)
                .sort();
        } catch (error) {
            return [];
        }
    }

    /**
     * Group events by date for efficient storage
     */
    private groupEventsByDate(events: CopilotUsageEvent[]): Map<string, CopilotUsageEvent[]> {
        const grouped = new Map<string, CopilotUsageEvent[]>();
        
        for (const event of events) {
            const dateKey = this.formatDateKey(new Date(event.timestamp));
            if (!grouped.has(dateKey)) {
                grouped.set(dateKey, []);
            }
            grouped.get(dateKey)!.push(event);
        }
        
        return grouped;
    }

    /**
     * Append events to a date-specific file
     */
    private async appendEventsToDateFile(dateKey: string, events: CopilotUsageEvent[]): Promise<void> {
        const fileName = `${dateKey}.json`;
        const fileUri = vscode.Uri.joinPath(this.eventsDir, fileName);
        
        let existingEvents: CopilotUsageEvent[] = [];
        
        // Load existing events if file exists
        try {
            const content = await vscode.workspace.fs.readFile(fileUri);
            existingEvents = JSON.parse(Buffer.from(content).toString('utf8'));
        } catch (error) {
            // File doesn't exist or is empty, start fresh
        }
        
        // Merge and deduplicate
        const allEvents = [...existingEvents, ...events];
        const deduplicatedEvents = this.deduplicateEvents(allEvents);
        
        // Sort by timestamp
        deduplicatedEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        
        // Write back to file
        const content = JSON.stringify(deduplicatedEvents, null, 2);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
        
        // Update index if this is a new file
        const index = await this.getStorageIndex();
        if (!index.eventFiles.includes(fileName)) {
            index.eventFiles.push(fileName);
            index.eventFiles.sort();
            await this.updateStorageIndex(index);
        }
    }

    /**
     * Get events for a specific date
     */
    private async getEventsForDate(dateKey: string): Promise<CopilotUsageEvent[]> {
        const fileName = `${dateKey}.json`;
        return this.loadEventFile(fileName);
    }

    /**
     * Load events from a specific file
     */
    private async loadEventFile(fileName: string): Promise<CopilotUsageEvent[]> {
        try {
            const fileUri = vscode.Uri.joinPath(this.eventsDir, fileName);
            const content = await vscode.workspace.fs.readFile(fileUri);
            return JSON.parse(Buffer.from(content).toString('utf8'));
        } catch (error) {
            return [];
        }
    }

    /**
     * Remove duplicate events based on ID
     */
    private deduplicateEvents(events: CopilotUsageEvent[]): CopilotUsageEvent[] {
        const seen = new Set<string>();
        return events.filter(event => {
            if (seen.has(event.id)) {
                return false;
            }
            seen.add(event.id);
            return true;
        });
    }

    /**
     * Format date as YYYY-MM-DD for consistent file naming
     */
    private formatDateKey(date: Date): string {
        return date.toISOString().split('T')[0];
    }

    /**
     * Generate array of dates between start and end
     */
    private generateDateRange(start: Date, end: Date): Date[] {
        const dates: Date[] = [];
        const current = new Date(start);
        
        while (current <= end) {
            dates.push(new Date(current));
            current.setDate(current.getDate() + 1);
        }
        
        return dates;
    }
}
