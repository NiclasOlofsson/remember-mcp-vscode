# Copilot Usage History Web Panel Architecture

> **IMPORTANT CONTEXT NOTICE FOR AI AGENT:**
> 
> This architecture document was created in the WRONG project context. It was developed while working in the `mcpmemoryagent` repository (a Python MCP server project), but the requirements were for a VS Code extension feature.
> 
> **What happened:**
> - User requested design for a "Copilot Usage History" web panel for a VS Code extension
> - I researched VS Code extension APIs, webview panels, storage, Chart.js, etc.
> - I created comprehensive architecture assuming this was for a VS Code extension project
> - User realized we're in the wrong repository - this should be for a VS Code extension project
> 
> **What needs to happen:**
> - This document needs to be moved to the actual VS Code extension project
> - The architecture is correct for VS Code extensions but doesn't belong in this Python MCP server repo
> - Continue implementation in the proper VS Code extension repository context
> 
> **Architecture validity:** The technical design, research, and specifications are accurate for VS Code extension development, just created in wrong project context.

## Executive Summary

This document outlines the architecture and design for a new "Copilot Usage History" web panel feature for a VS Code extension. The feature will provide comprehensive tracking, persistence, and visualization of GitHub Copilot usage across multiple VS Code instances with time-based analytics and duplicate prevention.

## Table of Contents

1. [Requirements Summary](#requirements-summary)
2. [Architecture Overview](#architecture-overview)
3. [Data Model & Storage](#data-model--storage)
4. [Web Panel Implementation](#web-panel-implementation)
5. [Data Visualization](#data-visualization)
6. [Log Processing Pipeline](#log-processing-pipeline)
7. [Concurrency & Performance](#concurrency--performance)
8. [Implementation Plan](#implementation-plan)
9. [Technical Specifications](#technical-specifications)

## Requirements Summary

### Core Features
- **Persistence**: Store usage history in VS Code-native storage
- **Concurrency**: Handle multiple VS Code instances safely
- **Time-based Analysis**: Visualize data by day/week/month
- **Historical Scanning**: Parse existing Copilot chat logs
- **Duplicate Prevention**: Use unique IDs to avoid duplicate events
- **Complete Event Storage**: Store all event data, not just summaries
- **UX Best Practices**: Follow VS Code developer guidelines

### Technical Requirements
- Leverage existing MCP server infrastructure
- Build on current log parsing capabilities
- Use VS Code webview panels for UI
- Follow VS Code storage and theming patterns
- Ensure thread-safe concurrent operations

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    VS Code Extension Layer                     │
├─────────────────┬─────────────────┬─────────────────────────────┤
│   Webview Panel │   Storage API   │     Event Collection        │
│                 │                 │                             │
│ ┌─────────────┐ │ ┌─────────────┐ │ ┌─────────────────────────┐ │
│ │ HTML/CSS/JS │ │ │ globalState │ │ │   Log File Monitors     │ │
│ │ Chart.js    │ │ │ workspace   │ │ │   Event Processors      │ │
│ │ Data Tables │ │ │ storageUri  │ │ │   Deduplication Engine  │ │
│ └─────────────┘ │ └─────────────┘ │ └─────────────────────────┘ │
└─────────────────┴─────────────────┴─────────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────────────┐
│                    MCP Server Layer                            │
├─────────────────┬─────────────────┬─────────────────────────────┤
│ Usage Tracking  │  Data Storage   │     Query Interface         │
│                 │                 │                             │
│ ┌─────────────┐ │ ┌─────────────┐ │ ┌─────────────────────────┐ │
│ │ Event Parser│ │ │ SQLite DB   │ │ │   REST/MCP Endpoints    │ │
│ │ Log Scanner │ │ │ JSON Store  │ │ │   Analytics Queries     │ │
│ │ ID Generator│ │ │ File System │ │ │   Export Functions      │ │
│ └─────────────┘ │ └─────────────┘ │ └─────────────────────────┘ │
└─────────────────┴─────────────────┴─────────────────────────────┘
```

## Data Model & Storage

### Event Data Structure

```typescript
interface CopilotUsageEvent {
  id: string;                    // UUID for deduplication
  timestamp: ISO8601String;      // Event timestamp
  type: 'chat' | 'completion' | 'edit' | 'explain';
  source: 'copilot-chat' | 'copilot-inline' | 'copilot-sidebar';
  
  // Session Information
  sessionId: string;             // VS Code session identifier
  workspaceId?: string;          // Workspace folder hash
  
  // Event Details
  duration?: number;             // Interaction duration (ms)
  tokensUsed?: number;           // Estimated token usage
  model?: string;                // AI model used
  
  // Context
  language?: string;             // Programming language
  filePath?: string;             // File being edited (anonymized)
  userPrompt?: string;           // User's input (if tracking enabled)
  
  // Metadata
  vsCodeVersion: string;
  copilotVersion: string;
  extensionVersion: string;
}

interface UsageStatistics {
  totalEvents: number;
  eventsToday: number;
  eventsThisWeek: number;
  eventsThisMonth: number;
  
  topLanguages: Array<{language: string, count: number}>;
  averageSessionDuration: number;
  totalTokensUsed: number;
  
  dailyBreakdown: Array<{date: string, count: number}>;
  weeklyBreakdown: Array<{week: string, count: number}>;
  monthlyBreakdown: Array<{month: string, count: number}>;
}
```

### Storage Strategy

Based on VS Code best practices research:

**Primary Storage: VS Code globalState + File System**
```typescript
// globalState for metadata and indices
await context.globalState.update('copilot-usage-index', {
  totalEvents: number,
  lastUpdate: timestamp,
  eventFiles: string[],
  settings: object
});

// File system for event data (chunked by date)
// ${storageUri}/copilot-usage/events/2025/01/20250108.json
```

**Secondary Storage: SQLite for Analytics**
```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  timestamp DATETIME,
  type TEXT,
  source TEXT,
  session_id TEXT,
  workspace_id TEXT,
  language TEXT,
  tokens_used INTEGER,
  duration INTEGER,
  metadata JSON
);

CREATE INDEX idx_timestamp ON events(timestamp);
CREATE INDEX idx_type ON events(type);
CREATE INDEX idx_language ON events(language);
```

### Concurrency Model

**File-Level Locking**
```typescript
class ConcurrentEventStore {
  private lockManager = new Map<string, Promise<void>>();
  
  async writeEvent(event: CopilotUsageEvent): Promise<void> {
    const dateKey = event.timestamp.substring(0, 10); // YYYY-MM-DD
    const lockKey = `events-${dateKey}`;
    
    // Serialize writes per day
    if (this.lockManager.has(lockKey)) {
      await this.lockManager.get(lockKey);
    }
    
    const writePromise = this._performWrite(event, dateKey);
    this.lockManager.set(lockKey, writePromise);
    
    try {
      await writePromise;
    } finally {
      this.lockManager.delete(lockKey);
    }
  }
}
```

## Web Panel Implementation

### Webview Panel Architecture

**Panel Registration & Lifecycle**
```typescript
class CopilotUsagePanel {
  public static readonly viewType = 'copilotUsageHistory';
  
  public static createOrShow(context: vscode.ExtensionContext) {
    // Singleton pattern for panel instance
    // Register webview provider
    // Handle panel state restoration
  }
  
  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly storageManager: UsageStorageManager
  ) {
    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, 'webview-ui', 'build')
      ]
    };
    
    this.panel.webview.html = this.getWebviewContent();
    this.handleMessages();
  }
}
```

**Message Passing Interface**
```typescript
interface WebviewMessage {
  command: 'getUsageData' | 'exportData' | 'updateSettings' | 'refreshData';
  payload?: any;
}

interface WebviewResponse {
  command: string;
  data: UsageStatistics | CopilotUsageEvent[] | ErrorInfo;
  success: boolean;
}
```

### Security & Resource Management

**Content Security Policy**
```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  style-src ${webview.cspSource} 'unsafe-inline';
  script-src ${webview.cspSource};
  font-src ${webview.cspSource};
  img-src ${webview.cspSource} data:;
">
```

**Resource Loading**
```typescript
private getWebviewContent(): string {
  const stylesheetUri = this.panel.webview.asWebviewUri(
    vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'build', 'assets', 'index.css')
  );
  
  const scriptUri = this.panel.webview.asWebviewUri(
    vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'build', 'assets', 'index.js')
  );
  
  return `<!DOCTYPE html>
    <html>
      <head>
        <link href="${stylesheetUri}" rel="stylesheet">
      </head>
      <body>
        <div id="app"></div>
        <script src="${scriptUri}"></script>
      </body>
    </html>`;
}
```

## Data Visualization

### Chart Library Selection: Chart.js

Based on research, **Chart.js** is the optimal choice because:

- **Lightweight**: Small bundle size suitable for VS Code webviews
- **Responsive**: Automatic resizing and mobile-friendly
- **Canvas Rendering**: Better performance for moderate datasets
- **Rich API**: Comprehensive options and plugins
- **VS Code Integration**: Works well within webview constraints
- **Theming Support**: Can adapt to VS Code light/dark themes

**Chart.js Implementation**
```javascript
// Time series chart for daily usage
const dailyUsageChart = new Chart(ctx, {
  type: 'line',
  data: {
    labels: dailyLabels, // ['2025-01-01', '2025-01-02', ...]
    datasets: [{
      label: 'Daily Copilot Usage',
      data: dailyData,   // [15, 23, 18, ...]
      borderColor: 'var(--vscode-charts-blue)',
      backgroundColor: 'var(--vscode-charts-blue-transparent)',
      tension: 0.4
    }]
  },
  options: {
    responsive: true,
    plugins: {
      tooltip: {
        backgroundColor: 'var(--vscode-tooltip-background)',
        titleColor: 'var(--vscode-tooltip-foreground)',
        bodyColor: 'var(--vscode-tooltip-foreground)'
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: {
          color: 'var(--vscode-panel-border)'
        },
        ticks: {
          color: 'var(--vscode-foreground)'
        }
      },
      x: {
        grid: {
          color: 'var(--vscode-panel-border)'
        },
        ticks: {
          color: 'var(--vscode-foreground)'
        }
      }
    }
  }
});
```

### Dashboard Layout

**HTML Structure**
```html
<div class="usage-dashboard">
  <header class="dashboard-header">
    <h1>Copilot Usage History</h1>
    <div class="controls">
      <select id="timeRange">
        <option value="7d">Last 7 Days</option>
        <option value="30d">Last 30 Days</option>
        <option value="90d">Last 90 Days</option>
      </select>
      <button id="export">Export Data</button>
      <button id="refresh">Refresh</button>
    </div>
  </header>
  
  <section class="summary-cards">
    <div class="card">
      <h3>Total Events</h3>
      <span class="metric" id="totalEvents">--</span>
    </div>
    <div class="card">
      <h3>Today</h3>
      <span class="metric" id="todayEvents">--</span>
    </div>
    <div class="card">
      <h3>This Week</h3>
      <span class="metric" id="weekEvents">--</span>
    </div>
    <div class="card">
      <h3>Avg Session</h3>
      <span class="metric" id="avgSession">--</span>
    </div>
  </section>
  
  <section class="charts-container">
    <div class="chart-panel">
      <h3>Usage Over Time</h3>
      <canvas id="timeSeriesChart"></canvas>
    </div>
    <div class="chart-panel">
      <h3>Event Types</h3>
      <canvas id="eventTypesChart"></canvas>
    </div>
    <div class="chart-panel">
      <h3>Languages</h3>
      <canvas id="languagesChart"></canvas>
    </div>
  </section>
  
  <section class="events-table">
    <h3>Recent Events</h3>
    <table id="eventsTable">
      <thead>
        <tr>
          <th>Time</th>
          <th>Type</th>
          <th>Language</th>
          <th>Duration</th>
          <th>Tokens</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  </section>
</div>
```

### Theme Integration

**CSS Variables for VS Code Theming**
```css
:root {
  --primary-color: var(--vscode-button-background);
  --primary-hover: var(--vscode-button-hoverBackground);
  --text-color: var(--vscode-foreground);
  --background-color: var(--vscode-editor-background);
  --border-color: var(--vscode-panel-border);
  --card-background: var(--vscode-sideBar-background);
}

.usage-dashboard {
  background-color: var(--background-color);
  color: var(--text-color);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}

.card {
  background-color: var(--card-background);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 16px;
}

.metric {
  font-size: 2rem;
  font-weight: bold;
  color: var(--primary-color);
}
```

## Log Processing Pipeline

### Log File Discovery

**VS Code Copilot Log Locations**
```typescript
const LOG_PATHS = {
  windows: [
    path.join(os.homedir(), 'AppData/Roaming/Code/logs'),
    path.join(os.homedir(), 'AppData/Roaming/Code - Insiders/logs')
  ],
  darwin: [
    path.join(os.homedir(), 'Library/Application Support/Code/logs'),
    path.join(os.homedir(), 'Library/Application Support/Code - Insiders/logs')
  ],
  linux: [
    path.join(os.homedir(), '.config/Code/logs'),
    path.join(os.homedir(), '.config/Code - Insiders/logs')
  ]
};

async function findCopilotLogs(): Promise<string[]> {
  const platform = os.platform();
  const searchPaths = LOG_PATHS[platform] || LOG_PATHS.linux;
  
  const logFiles: string[] = [];
  
  for (const basePath of searchPaths) {
    try {
      // Look for copilot-related log files
      // Pattern: */exthost/output_logging_*/1-GitHub.Copilot.log
      const pattern = path.join(basePath, '**/exthost/**/1-GitHub.Copilot*.log');
      const files = await glob(pattern);
      logFiles.push(...files);
    } catch (error) {
      // Silently continue if path doesn't exist
    }
  }
  
  return logFiles;
}
```

### Event Extraction Pipeline

**Log Parsing & Event Extraction**
```typescript
class CopilotLogParser {
  private eventPatterns = {
    chatStart: /\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\].*copilot-chat.*session started/i,
    chatMessage: /\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\].*user message.*"([^"]+)"/i,
    completion: /\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\].*completion.*accepted.*duration:(\d+)/i,
    edit: /\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\].*edit.*applied.*language:(\w+)/i
  };
  
  async parseLogFile(filePath: string): Promise<CopilotUsageEvent[]> {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const events: CopilotUsageEvent[] = [];
    
    for (const line of lines) {
      for (const [type, pattern] of Object.entries(this.eventPatterns)) {
        const match = pattern.exec(line);
        if (match) {
          const event = this.createEventFromMatch(type, match, filePath);
          if (event) {
            events.push(event);
          }
        }
      }
    }
    
    return events;
  }
  
  private createEventFromMatch(
    type: string, 
    match: RegExpExecArray, 
    filePath: string
  ): CopilotUsageEvent | null {
    const [, timestamp, ...groups] = match;
    
    return {
      id: this.generateEventId(timestamp, type, filePath),
      timestamp: new Date(timestamp).toISOString(),
      type: this.mapEventType(type),
      source: this.inferSource(type),
      sessionId: this.extractSessionId(filePath),
      language: this.extractLanguage(groups),
      duration: this.extractDuration(groups),
      vsCodeVersion: this.inferVSCodeVersion(filePath),
      copilotVersion: 'unknown',
      extensionVersion: vscode.extensions.getExtension('ms-copilot.copilot')?.packageJSON.version
    };
  }
  
  private generateEventId(timestamp: string, type: string, filePath: string): string {
    // Create deterministic UUID from timestamp + type + file path
    const input = `${timestamp}-${type}-${path.basename(filePath)}`;
    return uuidv5(input, uuidv5.DNS);
  }
}
```

### Deduplication Strategy

**Duplicate Detection & Prevention**
```typescript
class EventDeduplicator {
  private seenIds = new Set<string>();
  
  async loadExistingIds(storageManager: UsageStorageManager): Promise<void> {
    const existingEvents = await storageManager.getAllEvents();
    this.seenIds = new Set(existingEvents.map(event => event.id));
  }
  
  filterDuplicates(events: CopilotUsageEvent[]): CopilotUsageEvent[] {
    return events.filter(event => {
      if (this.seenIds.has(event.id)) {
        return false;
      }
      
      this.seenIds.add(event.id);
      return true;
    });
  }
  
  // Alternative: Content-based deduplication for imperfect ID matching
  private contentHash(event: Partial<CopilotUsageEvent>): string {
    const key = `${event.timestamp}-${event.type}-${event.language}-${event.duration}`;
    return crypto.createHash('sha256').update(key).digest('hex').substring(0, 16);
  }
}
```

## Concurrency & Performance

### Multi-Instance Synchronization

**File System Locking**
```typescript
class FileSystemLock {
  private lockDir: string;
  
  constructor(basePath: string) {
    this.lockDir = path.join(basePath, '.locks');
  }
  
  async acquireLock(resource: string, timeout = 5000): Promise<() => void> {
    const lockFile = path.join(this.lockDir, `${resource}.lock`);
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        await fs.mkdir(this.lockDir, { recursive: true });
        const fd = await fs.open(lockFile, 'wx');
        await fd.write(JSON.stringify({
          pid: process.pid,
          timestamp: Date.now(),
          resource
        }));
        await fd.close();
        
        // Return unlock function
        return async () => {
          try {
            await fs.unlink(lockFile);
          } catch (error) {
            // Lock file might have been cleaned up already
          }
        };
      } catch (error) {
        if (error.code === 'EEXIST') {
          // Lock exists, check if stale
          try {
            const stats = await fs.stat(lockFile);
            if (Date.now() - stats.mtime.getTime() > 30000) {
              // Stale lock (30s+), remove it
              await fs.unlink(lockFile);
              continue;
            }
          } catch {
            // Lock file removed by another process
            continue;
          }
          
          // Wait and retry
          await new Promise(resolve => setTimeout(resolve, 100));
        } else {
          throw error;
        }
      }
    }
    
    throw new Error(`Failed to acquire lock for ${resource} within ${timeout}ms`);
  }
}
```

### Performance Optimizations

**Batch Processing & Chunking**
```typescript
class PerformantEventProcessor {
  private batchSize = 1000;
  private processingQueue: CopilotUsageEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  
  async addEvent(event: CopilotUsageEvent): Promise<void> {
    this.processingQueue.push(event);
    
    if (this.processingQueue.length >= this.batchSize) {
      await this.flush();
    } else {
      this.scheduleFlush();
    }
  }
  
  private scheduleFlush(): void {
    if (this.flushTimer) return;
    
    this.flushTimer = setTimeout(() => {
      this.flush();
    }, 5000); // Flush every 5 seconds
  }
  
  private async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    
    if (this.processingQueue.length === 0) return;
    
    const events = this.processingQueue.splice(0);
    await this.storageManager.batchInsert(events);
  }
}
```

**Memory Management**
```typescript
class MemoryEfficientAnalytics {
  async calculateStatistics(
    dateRange: DateRange,
    maxMemoryMB = 100
  ): Promise<UsageStatistics> {
    const maxEvents = (maxMemoryMB * 1024 * 1024) / 1000; // ~1KB per event
    
    if (await this.estimateEventCount(dateRange) > maxEvents) {
      // Use streaming approach for large datasets
      return this.calculateStatisticsStreaming(dateRange);
    } else {
      // Load all into memory for small datasets
      return this.calculateStatisticsInMemory(dateRange);
    }
  }
  
  private async calculateStatisticsStreaming(
    dateRange: DateRange
  ): Promise<UsageStatistics> {
    const aggregator = new StreamingAggregator();
    
    await this.storageManager.streamEvents(dateRange, (event) => {
      aggregator.addEvent(event);
    });
    
    return aggregator.getStatistics();
  }
}
```

## Implementation Plan

### Phase 1: Foundation (Week 1-2)
- [ ] Set up webview panel infrastructure
- [ ] Implement basic storage layer (globalState + files)
- [ ] Create data models and TypeScript interfaces
- [ ] Basic HTML/CSS layout with VS Code theming

### Phase 2: Data Pipeline (Week 3-4)
- [ ] Log file discovery and parsing
- [ ] Event extraction and deduplication
- [ ] Batch processing and storage
- [ ] Basic analytics calculations

### Phase 3: Visualization (Week 5-6)
- [ ] Chart.js integration
- [ ] Time series charts (daily/weekly/monthly)
- [ ] Event type distribution charts
- [ ] Language usage breakdown

### Phase 4: Advanced Features (Week 7-8)
- [ ] Concurrency handling and file locking
- [ ] Performance optimizations
- [ ] Export functionality
- [ ] Historical log scanning

### Phase 5: Polish & Testing (Week 9-10)
- [ ] Error handling and edge cases
- [ ] Unit and integration tests
- [ ] Documentation updates
- [ ] Performance profiling and optimization

## Technical Specifications

### File Structure
```
src/
├── webview/
│   ├── copilot-usage-panel.ts         # Main panel controller
│   ├── webview-content/
│   │   ├── index.html                 # Panel HTML template
│   │   ├── styles.css                 # VS Code-themed CSS
│   │   └── main.js                    # Chart.js & interaction logic
│   └── message-handlers.ts            # Webview ↔ extension communication
├── storage/
│   ├── usage-storage-manager.ts       # Storage abstraction layer
│   ├── concurrent-event-store.ts      # Thread-safe event storage
│   └── analytics-engine.ts            # Statistics calculation
├── parsing/
│   ├── copilot-log-parser.ts         # Log file parsing
│   ├── event-extractor.ts            # Event pattern matching
│   └── deduplicator.ts               # Duplicate prevention
├── utils/
│   ├── file-system-lock.ts           # Cross-instance coordination
│   ├── performance-monitor.ts        # Memory & CPU tracking
│   └── log-discovery.ts              # VS Code log file finding
└── types/
    ├── usage-events.ts               # Event data structures
    └── analytics.ts                  # Statistics interfaces
```

### Configuration Options
```typescript
interface CopilotUsageSettings {
  // Data Collection
  enableTracking: boolean;
  trackUserPrompts: boolean;
  retentionDays: number;
  
  // Performance
  maxEventsInMemory: number;
  batchSize: number;
  refreshIntervalMs: number;
  
  // UI
  defaultTimeRange: '7d' | '30d' | '90d';
  enableAnimations: boolean;
  chartTheme: 'auto' | 'light' | 'dark';
  
  // Storage
  storageLocation: 'global' | 'workspace';
  compressionEnabled: boolean;
  autoCleanup: boolean;
}
```

### Error Handling Strategy
```typescript
class CopilotUsageErrorHandler {
  private errorCounts = new Map<string, number>();
  
  async handleError(error: Error, context: string): Promise<void> {
    const errorKey = `${context}:${error.name}`;
    const count = this.errorCounts.get(errorKey) || 0;
    this.errorCounts.set(errorKey, count + 1);
    
    // Log with appropriate level
    if (count === 0) {
      console.error(`First occurrence of ${errorKey}:`, error);
    } else if (count < 5) {
      console.warn(`Repeated error ${errorKey} (${count + 1} times):`, error.message);
    } else {
      // Suppress repeated errors after 5 occurrences
      return;
    }
    
    // Send telemetry for critical errors
    if (this.isCriticalError(error)) {
      this.sendErrorTelemetry(error, context, count);
    }
    
    // Attempt recovery
    await this.attemptRecovery(error, context);
  }
}
```

This architecture provides a comprehensive, scalable, and maintainable solution for tracking and visualizing Copilot usage history while following VS Code development best practices and ensuring robust performance across multiple concurrent instances.
