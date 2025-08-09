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

**Law 15:** For this VS Code extension project:
- Before any commit, always run: `npm run compile` and `npm run lint`
- Ensure webpack compilation succeeds before staging files
- All TypeScript files must compile without errors
- ESLint must pass without warnings for production commits
- If build fails, fix issues before committing any files
- **2025-08-09 12:15:** VS Code Marketplace Publishing Best Practices and Workflow:

DUAL README STRATEGY:
- Keep single source README.md in GitHub with all developer content
- Use HTML comment markers to exclude developer-only sections: <!-- MARKETPLACE-EXCLUDE-START --> and <!-- MARKETPLACE-EXCLUDE-END -->
- Auto-generate marketplace-specific README during build process
- Add README_marketplace.md to .gitignore (treat as build artifact, not source)

ESSENTIAL PACKAGE.JSON SCRIPTS:
- "generate-marketplace-readme": "node scripts/generate-marketplace-readme.js" (filters README)
- "package:marketplace": "npm run bump-version && npm run generate-marketplace-readme && vsce package --readme-path README_marketplace.md"
- "publish:marketplace": "npm run package:marketplace && vsce publish --readme-path README_marketplace.md"
- Always use --readme-path flag to specify filtered README for packaging

VSCE PUBLISHING WORKFLOW:
1. Edit only README.md with exclusion markers around developer content
2. Run npm run publish:marketplace (auto-bumps version, generates filtered README, packages, publishes)
3. Never manually maintain separate README files
4. Marketplace gets clean user-focused docs, GitHub keeps complete developer docs

EXCLUSION STRATEGY:
- Exclude: Picture logos, developer badges, detailed usage instructions, configuration details, development sections, contributing guidelines, related projects
- Include: Core value proposition, features list, basic installation, how it works, troubleshooting, license
- Target: ~4500-5000 chars for marketplace (down from 7000-8000 original)

TECHNICAL DETAILS:
- VSIX packages are case-insensitive (avoid filename conflicts)
- .vscodeignore excludes files from VSIX package (not the same as .gitignore)
- vsce prepublish script runs automatically during publishing
- Always commit version bumps back to git after publishing
- Marketplace URLs: https://marketplace.visualstudio.com/items?itemName=publisher.extension-name
- **2025-08-09 13:37:** For the remember-vscode workspace: Never install VSIX packages using code-insiders --install-extension. The user will always use F5 (Extension Development Host) to test extensions. Only build/compile the code - never install it globally.
