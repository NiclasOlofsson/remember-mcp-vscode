# Meet Remember MCP – Real Memory for VS Code & Your AI

**Remember MCP**, the VS Code extension that brings real, persistent memory to your AI assistant and your team. Instantly store preferences, facts, and best practices—so Copilot always knows your context, and your team’s knowledge is never lost.

Want to explore or run the Mode Manager MCP server directly? [Check out Mode Manager MCP on GitHub](https://github.com/NiclasOlofsson/mode-manager-mcp) for standalone usage, advanced memory management, and more features.

**Track your Copilot model usage and premium requests!** This extension was built not only to simplify installation of Mode Manager MCP, but also to help you monitor and control your GitHub Copilot usage—so you can keep an eye on premium requests and manage costs.

## Why “Remember MCP”? (Features & Benefits)

- **Copilot Model Usage Monitoring**: Track premium requests and keep tabs on your GitHub Copilot usage—manage costs and avoid surprises.
- **Personal AI Memory**: Your preferences, habits, and reminders are always available to Copilot.
- **Workspace (Team) Memory**: Share onboarding notes, coding conventions, and project wisdom—right in your repo.
- **Language-Specific Memory**: Save and retrieve tips for Python, C#, and more. Your assistant adapts automatically.
- **Native MCP Integration**: Seamless registration with VS Code’s Model Context Protocol (MCP) system.
- **Visual Management**: Effortless control via activity bar and status bar.
- **Smarter Coding, Fewer Repeated Questions**: Your memory grows over time, making your AI and team smarter.
## Copilot Model Usage Monitoring

One of the most valuable features of Remember MCP is its ability to monitor your GitHub Copilot model usage. See how many premium requests you make, track your usage patterns, and stay aware of costs—so you can make informed decisions and avoid unexpected charges.

## Real-World Examples: Just Say It!

You don’t need special syntax—just talk to Copilot naturally. Remember MCP is extremely relaxed about how you phrase things. If it sounds like something you want remembered, it will be!

> You: I like detailed docstrings and use pytest for testing. (Copilot, keep that in mind.)
> Team: We always use the Oatly data pipeline template and follow our naming conventions. (Let’s make sure everyone remembers that.)
> Language: For Python, use type hints and Black formatting. In C#, always use nullable reference types.

## Get It Running (2 Minutes)

Getting started is usually automatic! Remember MCP makes a good effort to detect if Python and pipx are installed, and will even install pipx for you if Python is present. Most users won’t need to do anything—just install the extension and let it handle setup.  

If everything else fails, here’s how you get it running manually:

### 1. Install Python
Get it at [python.org/downloads](https://www.python.org/downloads/)

### 2. Install pipx
```bash
pip install pipx
```

### 3. Install this extension from the VS Code marketplace

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/nickeolofsson.remember-mcp-vscode?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=nickeolofsson.remember-mcp-vscode)

## How It Works (Under the Hood)

Remember MCP uses VS Code’s official MCP API to:
- Register your mode-manager-mcp server with VS Code
- VS Code automatically manages the server lifecycle (starts/stops as needed)
- Copilot automatically discovers and uses your memory and chat modes
- No manual process management—VS Code handles everything!

### Memory Scopes
- **Personal Memory**: Stored in your user prompts directory—private to you.
- **Workspace Memory**: Shared in the repo for your team.
- **Language Memory**: Automatically loaded for each language.

### How Memory is Stored & Loaded
All memory is saved as Markdown files with YAML frontmatter—human- and machine-readable. Mode Manager MCP creates and updates these files as you add new memories. VS Code Copilot Chat loads them every turn, so your context is always active.

## Troubleshooting

### Server Won't Register?
1. Ensure Python 3.10+ is installed: `python --version`
2. Check if pipx is available: `pipx --version`
3. Verify mode-manager-mcp is available: `pipx run mode-manager-mcp --help`
4. Check the Output panel for error messages
5. Ensure VS Code 1.102.0+ (MCP API support required)

