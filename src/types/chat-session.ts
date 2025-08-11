/**
 * Type definitions for VS Code Chat Session files
 * Based on the actual structure found in chatSessions directories
 */

export interface CopilotChatSession {
    version: number;
    sessionId: string;
    creationDate: number; // Unix timestamp
    lastMessageDate: number; // Unix timestamp
    requesterUsername: string;
    responderUsername: string;
    initialLocation: string;
    isImported?: boolean;
    requests: CopilotChatRequest[];
}

export interface CopilotChatRequest {
    requestId: string;
    responseId: string;
    timestamp: number; // Unix timestamp
    modelId?: string; // Optional - not all requests have a modelId
    isCanceled: boolean;
    
    // User message
    message: {
        text: string;
        parts: Array<{
            [key: string]: any;
        }>;
    };
    
    // Variable data
    variableData?: {
        variables: Array<{
            [key: string]: any;
        }>;
    };
    
    // Agent information (optional - slash commands like /clear don't have an agent)
    agent?: {
        id: string;                    // e.g., "github.copilot.editsAgent"
        name: string;                  // e.g., "agent"
        extensionId: string;           // e.g., "github.copilot"
        extensionDisplayName?: string;
        publisherDisplayName?: string;
        description?: string;
        fullName?: string;
        isDefault?: boolean;
        [key: string]: any;
    };
    
    // Response content
    response: Array<{
        value: string;
        kind?: string;
        [key: string]: any;
    }>;
    
    // Performance metrics
    result?: {
        timings?: {
            totalElapsed: number;
            firstProgress: number;
        };
        metadata?: {
            [key: string]: any;
        };
        [key: string]: any;
    };
    
    // Context and references
    contentReferences?: Array<{
        reference: {
            uri: string;
            range?: {
                start: { line: number; character: number };
                end: { line: number; character: number };
            };
        };
        [key: string]: any;
    }>;
    
    codeCitations?: Array<{
        license: string;
        snippet: string;
        [key: string]: any;
    }>;
    
    followups?: Array<{
        message: string;
        [key: string]: any;
    }>;
}

export interface SessionScanResult {
    sessionFilePath: string;
    session: CopilotChatSession;
    lastModified: Date;
    fileSize: number;
}

export interface SessionScanStats {
    totalSessions: number;
    totalRequests: number;
    scannedFiles: number;
    errorFiles: number;
    scanDuration: number;
    oldestSession?: string;
    newestSession?: string;
}

export interface SessionWatcherOptions {
    enableWatching: boolean;
    debounceMs: number;
    maxRetries: number;
}

export interface SessionMetadata {
    sessionId: string;
    workspaceHash: string;
    vscodeInstanceId: string;
    sessionStartTime: string;
    sessionEndTime?: string;
    requestCount: number;
    totalResponseLength: number;
    averageResponseTime: number;
    languagesUsed: string[];
    modelsUsed: string[];
    hasCodeCitations: boolean;
    hasContentReferences: boolean;
    hasFollowups: boolean;
}

// Constants for session scanning
export const SESSION_SCAN_CONSTANTS = {
    // VS Code storage paths
    VSCODE_STORAGE_PATHS: [
        'AppData/Roaming/Code/User/workspaceStorage',
        'AppData/Roaming/Code - Insiders/User/workspaceStorage'
    ],
    
    // Chat session directory name
    CHAT_SESSIONS_DIR: 'chatSessions',
    
    // File patterns
    SESSION_FILE_PATTERN: /^[a-f0-9-]+\.json$/,
    
    // Scan limits
    MAX_FILES_PER_SCAN: 1000,
    MAX_FILE_SIZE_MB: 10,
    
    // Debounce settings
    DEFAULT_DEBOUNCE_MS: 500,
    
    // Retry settings
    DEFAULT_MAX_RETRIES: 3
} as const;
