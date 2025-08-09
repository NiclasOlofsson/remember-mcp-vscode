/**
 * Standalone test script for Copilot log parser
 * Run with: node test-log-parser.js
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Minimal event interface for testing
class TestEvent {
    constructor(data) {
        this.id = data.id;
        this.timestamp = data.timestamp;
        this.type = data.type;
        this.source = data.source;
        this.sessionId = data.sessionId;
        this.workspaceId = data.workspaceId;
        this.duration = data.duration;
        this.tokensUsed = data.tokensUsed;
        this.model = data.model;
        this.language = data.language;
        this.filePath = data.filePath;
        this.vsCodeVersion = data.vsCodeVersion;
        this.copilotVersion = data.copilotVersion;
        this.extensionVersion = data.extensionVersion;
    }
}

// Simplified log parser for testing
class TestCopilotLogParser {
    constructor() {
        this.LOG_PATHS = {
            win32: [
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

        this.EVENT_PATTERNS = {
            // Authentication and session events
            loginEvent: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[info\] Logged in as (\w+)/,
            tokenReceived: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[info\] Got Copilot token for (\w+)/,
            
            // Model and capability events
            modelMetadata: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[info\] Fetched model metadata in (\d+)ms (.+)/,
            refetchMetadata: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[info\] Refetch model metadata: Succeeded in (\d+)ms (.+)/,
            copilotCapabilities: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[info\] copilot token chat_enabled: (\w+), sku: (.+)/,
            
            // Feature activation and enablement
            featureActivation: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[info\] activationBlocker from '([^']+)' took for (\d+)ms/,
            agentRegistration: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[info\] Registering (.*?) agent/,
            
            // General service initialization
            serviceInit: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[info\] \[([^\]]+)\] (.+)/,
            
            // Catch-all for other info messages that might contain usage data
            infoMessage: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[info\] (.+)/
        };
    }

    log(message) {
        console.log(`[TestParser] ${message}`);
    }

    async findCopilotLogs() {
        const platform = os.platform();
        const searchPaths = this.LOG_PATHS[platform] || this.LOG_PATHS.linux;
        
        const logFiles = [];
        
        for (const basePath of searchPaths) {
            try {
                this.log(`Searching for logs in: ${basePath}`);
                
                const files = await this.findLogFilesInPath(basePath);
                logFiles.push(...files);
                
                this.log(`Found ${files.length} log files in ${basePath}`);
            } catch (error) {
                this.log(`Path not accessible: ${basePath} - ${error.message}`);
            }
        }
        
        this.log(`Total Copilot log files found: ${logFiles.length}`);
        return logFiles;
    }

    async findLogFilesInPath(basePath) {
        const logFiles = [];
        
        try {
            this.log(`Scanning directory structure in: ${basePath}`);
            
            // First, find all session directories (format: YYYYMMDDTHHMMSS)
            const sessionDirs = await this.findSessionDirectories(basePath);
            this.log(`Found ${sessionDirs.length} session directories`);
            
            for (const sessionDir of sessionDirs) {
                // Look for window directories within each session
                const windowDirs = await this.findWindowDirectories(sessionDir);
                this.log(`Found ${windowDirs.length} window directories in ${sessionDir}`);
                
                for (const windowDir of windowDirs) {
                    // Look for exthost directory
                    const extHostPath = path.join(windowDir, 'exthost');
                    if (await this.directoryExists(extHostPath)) {
                        // Find GitHub Copilot extension directories
                        const copilotDirs = await this.findCopilotExtensionDirectories(extHostPath);
                        
                        for (const copilotDir of copilotDirs) {
                            const files = await fs.readdir(copilotDir);
                            for (const file of files) {
                                if (file.endsWith('.log')) {
                                    const fullPath = path.join(copilotDir, file);
                                    logFiles.push(fullPath);
                                    this.log(`Found Copilot log: ${fullPath}`);
                                }
                            }
                        }
                        
                        // Also check output_logging directories for additional logs
                        const outputDirs = await this.findDirectories(extHostPath, 'output_logging_');
                        for (const outputDir of outputDirs) {
                            const files = await fs.readdir(outputDir);
                            for (const file of files) {
                                if (file.includes('GitHub.Copilot') && file.endsWith('.log')) {
                                    const fullPath = path.join(outputDir, file);
                                    logFiles.push(fullPath);
                                    this.log(`Found Copilot output log: ${fullPath}`);
                                }
                            }
                        }
                    }
                }
            }
        } catch (error) {
            this.log(`Error scanning ${basePath}: ${error.message}`);
            // Directory structure might be different, fallback to broad search
            try {
                const files = await this.findFilesRecursively(basePath, /GitHub\.Copilot.*\.log$/);
                logFiles.push(...files);
                this.log(`Fallback search found ${files.length} additional files`);
            } catch (fallbackError) {
                this.log(`Fallback search failed for ${basePath}: ${fallbackError.message}`);
            }
        }
        
        return logFiles;
    }

    async findSessionDirectories(basePath) {
        const sessionDirs = [];
        try {
            const entries = await fs.readdir(basePath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && /^\d{8}T\d{6}$/.test(entry.name)) {
                    sessionDirs.push(path.join(basePath, entry.name));
                }
            }
        } catch (error) {
            this.log(`Error reading session directories from ${basePath}: ${error.message}`);
        }
        return sessionDirs;
    }

    async findWindowDirectories(sessionPath) {
        const windowDirs = [];
        try {
            const entries = await fs.readdir(sessionPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name.startsWith('window')) {
                    windowDirs.push(path.join(sessionPath, entry.name));
                }
            }
        } catch (error) {
            this.log(`Error reading window directories from ${sessionPath}: ${error.message}`);
        }
        return windowDirs;
    }

    async directoryExists(dirPath) {
        try {
            const stat = await fs.stat(dirPath);
            return stat.isDirectory();
        } catch {
            return false;
        }
    }

    async findCopilotExtensionDirectories(extHostPath) {
        const copilotDirs = [];
        try {
            const entries = await fs.readdir(extHostPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && (
                    entry.name.includes('GitHub.copilot') || 
                    entry.name.includes('GitHub.copilot-chat')
                )) {
                    copilotDirs.push(path.join(extHostPath, entry.name));
                }
            }
        } catch (error) {
            this.log(`Error reading copilot directories from ${extHostPath}: ${error.message}`);
        }
        return copilotDirs;
    }

    async findDirectories(basePath, pattern) {
        try {
            const entries = await fs.readdir(basePath, { withFileTypes: true });
            return entries
                .filter(entry => entry.isDirectory() && entry.name.includes(pattern))
                .map(entry => path.join(basePath, entry.name));
        } catch (error) {
            return [];
        }
    }

    async findFilesRecursively(basePath, pattern) {
        const files = [];
        
        try {
            const entries = await fs.readdir(basePath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(basePath, entry.name);
                
                if (entry.isDirectory()) {
                    const subFiles = await this.findFilesRecursively(fullPath, pattern);
                    files.push(...subFiles);
                } else if (pattern.test(entry.name)) {
                    files.push(fullPath);
                }
            }
        } catch (error) {
            // Directory not accessible
        }
        
        return files;
    }

    async inspectLogFile(filePath, maxLines = 20) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n');
            
            console.log(`\n=== INSPECTING LOG FILE: ${filePath} ===`);
            console.log(`Total lines: ${lines.length}`);
            console.log(`File size: ${content.length} bytes`);
            
            // Show first few lines
            console.log(`\nFirst ${Math.min(maxLines, lines.length)} lines:`);
            for (let i = 0; i < Math.min(maxLines, lines.length); i++) {
                if (lines[i].trim()) {
                    console.log(`Line ${i + 1}: ${lines[i]}`);
                }
            }
            
            // Test our patterns against the content
            console.log(`\nTesting event patterns:`);
            let matchCount = 0;
            for (const [eventType, pattern] of Object.entries(this.EVENT_PATTERNS)) {
                const matches = content.match(new RegExp(pattern.source, 'gm'));
                if (matches && matches.length > 0) {
                    console.log(`  ${eventType}: ${matches.length} matches`);
                    matchCount += matches.length;
                    // Show first match as example
                    if (matches[0]) {
                        console.log(`    Example: ${matches[0].substring(0, 100)}...`);
                    }
                }
            }
            console.log(`Total pattern matches: ${matchCount}`);
            
            console.log(`=== END INSPECTION ===\n`);
            
            return {
                totalLines: lines.length,
                fileSize: content.length,
                patternMatches: matchCount
            };
        } catch (error) {
            console.log(`Failed to inspect log file ${filePath}: ${error.message}`);
            return null;
        }
    }

    async parseLogFile(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n');
            const events = [];
            
            this.log(`Parsing log file: ${filePath} (${lines.length} lines)`);
            
            for (const line of lines) {
                const event = this.extractEventFromLine(line, filePath);
                if (event) {
                    events.push(event);
                }
            }
            
            this.log(`Extracted ${events.length} events from ${filePath}`);
            return events;
        } catch (error) {
            this.log(`Failed to parse log file ${filePath}: ${error.message}`);
            return [];
        }
    }

    extractEventFromLine(line, filePath) {
        for (const [eventType, pattern] of Object.entries(this.EVENT_PATTERNS)) {
            const match = pattern.exec(line);
            if (match) {
                return this.createEventFromMatch(eventType, match, filePath, line);
            }
        }
        return null;
    }

    createEventFromMatch(eventType, match, filePath, originalLine) {
        const [, timestamp, ...groups] = match;
        const eventTime = new Date(timestamp);
        
        // Extract specific data based on event type
        let duration;
        let model;
        let tokensUsed;
        
        switch (eventType) {
            case 'modelMetadata':
            case 'refetchMetadata':
                duration = groups[0] ? parseInt(groups[0], 10) : undefined;
                model = groups[1] || 'unknown';
                tokensUsed = 20;
                break;
            case 'featureActivation':
                duration = groups[1] ? parseInt(groups[1], 10) : undefined;
                model = groups[0];
                tokensUsed = 10;
                break;
            case 'loginEvent':
            case 'tokenReceived':
                model = groups[0] || 'copilot';
                tokensUsed = 5;
                break;
            case 'copilotCapabilities':
                model = `${groups[0]}_${groups[1]}`;
                tokensUsed = 5;
                break;
            case 'agentRegistration':
                model = groups[0] || 'agent';
                tokensUsed = 5;
                break;
            case 'serviceInit':
                model = groups[0] || 'service';
                tokensUsed = 5;
                break;
            default:
                model = this.extractModelFromMessage(groups[0] || originalLine);
                tokensUsed = this.estimateTokensFromMessage(groups[0] || originalLine);
                break;
        }
        
        return new TestEvent({
            id: this.generateEventId(timestamp, eventType, filePath),
            timestamp: eventTime.toISOString(),
            type: this.mapEventType(eventType),
            source: this.inferSource(eventType, originalLine),
            sessionId: this.extractSessionId(filePath),
            workspaceId: this.extractWorkspaceId(originalLine),
            duration,
            tokensUsed,
            model,
            language: this.extractLanguage(groups, eventType),
            filePath: this.extractFilePath(originalLine),
            vsCodeVersion: this.inferVSCodeVersion(filePath),
            copilotVersion: 'unknown',
            extensionVersion: 'test'
        });
    }

    generateEventId(timestamp, eventType, filePath) {
        const input = `${timestamp}-${eventType}-${path.basename(filePath)}`;
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            const char = input.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return `copilot-${Math.abs(hash).toString(16)}-${Date.now().toString(36)}`;
    }

    mapEventType(eventType) {
        switch (eventType) {
            case 'loginEvent':
            case 'tokenReceived':
            case 'modelMetadata':
            case 'refetchMetadata':
            case 'copilotCapabilities':
            case 'agentRegistration':
                return 'chat';
            case 'featureActivation':
                return 'completion';
            case 'serviceInit':
                return 'edit';
            case 'infoMessage':
            default:
                return 'chat';
        }
    }

    inferSource(eventType, line) {
        if (line.includes('copilot-chat') || line.includes('chat')) {
            return 'copilot-chat';
        } else if (line.includes('inline') || line.includes('completion')) {
            return 'copilot-inline';
        } else {
            return 'copilot-sidebar';
        }
    }

    extractSessionId(filePath) {
        const dir = path.dirname(filePath);
        const sessionMatch = dir.match(/output_logging_(\d+)/);
        return sessionMatch ? sessionMatch[1] : path.basename(dir);
    }

    extractWorkspaceId(line) {
        const workspaceMatch = line.match(/workspace[:\s]+([^\s,}]+)/i);
        return workspaceMatch ? workspaceMatch[1] : undefined;
    }

    extractLanguage(groups, eventType) {
        if ((eventType === 'edit' || eventType === 'explain') && groups.length > 1) {
            return groups[1];
        }
        return undefined;
    }

    extractFilePath(line) {
        const fileMatch = line.match(/file[:\s]+([^\s,}]+)/i);
        if (fileMatch) {
            const ext = path.extname(fileMatch[1]);
            return ext ? `*${ext}` : undefined;
        }
        return undefined;
    }

    inferVSCodeVersion(filePath) {
        if (filePath.includes('Code - Insiders')) {
            return 'VS Code Insiders';
        } else if (filePath.includes('Code')) {
            return 'VS Code Stable';
        }
        return 'Unknown';
    }

    extractModelFromMessage(message) {
        const patterns = [
            /model[:\s]+([^\s,}]+)/i,
            /gpt[^\s,}]*/i,
            /claude[^\s,}]*/i,
            /copilot[^\s,}]*/i
        ];
        
        for (const pattern of patterns) {
            const match = message.match(pattern);
            if (match) {
                return match[1] || match[0];
            }
        }
        
        return undefined;
    }

    estimateTokensFromMessage(message) {
        if (!message) {
            return undefined;
        }
        
        const estimatedTokens = Math.ceil(message.length / 4);
        return Math.min(estimatedTokens, 1000);
    }
}

// Main test function
async function runTest() {
    console.log('=== COPILOT LOG PARSER TEST ===\n');
    
    const parser = new TestCopilotLogParser();
    
    try {
        // Step 1: Find all log files
        console.log('Step 1: Finding Copilot log files...');
        const logFiles = await parser.findCopilotLogs();
        
        if (logFiles.length === 0) {
            console.log('❌ No Copilot log files found!');
            console.log('This could mean:');
            console.log('  - Copilot extension is not installed');
            console.log('  - No recent Copilot activity');
            console.log('  - Logs are in a different location');
            return;
        }
        
        console.log(`✅ Found ${logFiles.length} log files\n`);
        
        // Step 2: Inspect a few files to understand their structure
        console.log('Step 2: Inspecting log file structure...');
        const filesToInspect = logFiles.slice(0, 3); // Inspect first 3 files
        
        let totalMatches = 0;
        for (const logFile of filesToInspect) {
            const inspection = await parser.inspectLogFile(logFile);
            if (inspection) {
                totalMatches += inspection.patternMatches;
            }
        }
        
        // Step 3: Parse all files and extract events
        console.log('Step 3: Parsing all log files...');
        const allEvents = [];
        
        for (const logFile of logFiles) {
            const events = await parser.parseLogFile(logFile);
            allEvents.push(...events);
        }
        
        // Step 4: Summary and statistics
        console.log('\n=== RESULTS SUMMARY ===');
        console.log(`Total log files found: ${logFiles.length}`);
        console.log(`Total events extracted: ${allEvents.length}`);
        console.log(`Total pattern matches in sample: ${totalMatches}`);
        
        if (allEvents.length > 0) {
            console.log('\n=== EVENT BREAKDOWN ===');
            const eventTypes = {};
            const sources = {};
            const models = {};
            
            allEvents.forEach(event => {
                eventTypes[event.type] = (eventTypes[event.type] || 0) + 1;
                sources[event.source] = (sources[event.source] || 0) + 1;
                if (event.model) {
                    models[event.model] = (models[event.model] || 0) + 1;
                }
            });
            
            console.log('Event types:');
            Object.entries(eventTypes).forEach(([type, count]) => {
                console.log(`  ${type}: ${count}`);
            });
            
            console.log('Sources:');
            Object.entries(sources).forEach(([source, count]) => {
                console.log(`  ${source}: ${count}`);
            });
            
            console.log('Models:');
            Object.entries(models).slice(0, 10).forEach(([model, count]) => {
                console.log(`  ${model}: ${count}`);
            });
            
            // Show sample events
            console.log('\n=== SAMPLE EVENTS ===');
            allEvents.slice(0, 5).forEach((event, index) => {
                console.log(`Event ${index + 1}:`);
                console.log(`  Timestamp: ${event.timestamp}`);
                console.log(`  Type: ${event.type}`);
                console.log(`  Source: ${event.source}`);
                console.log(`  Model: ${event.model || 'N/A'}`);
                console.log(`  Tokens: ${event.tokensUsed || 'N/A'}`);
                console.log('');
            });
        } else {
            console.log('\n❌ No events were extracted from the log files.');
            console.log('This suggests the regex patterns need adjustment for the actual log format.');
        }
        
        console.log('\n=== LOG FILE PATHS ===');
        logFiles.forEach((file, index) => {
            console.log(`${index + 1}. ${file}`);
        });
        
    } catch (error) {
        console.error('❌ Test failed with error:', error);
    }
}

// Run the test
runTest().then(() => {
    console.log('\n=== TEST COMPLETE ===');
}).catch(error => {
    console.error('Fatal error:', error);
});
