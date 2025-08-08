---
applyTo: '**'
description: Remember MCP VS Code Extension Project Context
---

# Remember MCP VS Code Extension Project

This project creates a VS Code extension that provides a visual interface for running and managing the mode-manager-mcp server.

## Project Structure
- TypeScript-based VS Code extension
- Uses npm for package management  
- Webpack for bundling
- Integrates with Python-based mode-manager-mcp server
- Provides panel UI for MCP server interaction

## Development Notes
- Extension name: "Remember MCP" 
- Namespace: remember-mcp-vscode
- Target: VS Code marketplace distribution
- Focus: Simple panel interface for MCP server visualization

## Features Implemented
- ✅ Server start/stop/restart functionality
- ✅ Activity bar integration with tree view
- ✅ Status bar monitoring
- ✅ Webview panel for server control
- ✅ Output channel for server logs
- ✅ Auto-start configuration
- ✅ Command palette integration

## Development Laws & Workflow

**Law 14:** Always check webpack watcher task status before running manual compile/lint/test operations.
- First, verify that the webpack watcher (`npm watch`) is running and healthy
- Only proceed with linting if webpack is running without problems
- This ensures build consistency and avoids redundant compilation steps
