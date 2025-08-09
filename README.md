<picture>[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/nickeolofsson.remember-mcp-vscode?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=nickeolofsson.remember-mcp-vscode)

<!-- MARKETPLACE-EXCLUDE-START -->
## 🔧 Development Status

[![CI Build](https://github.com/NiclasOlofsson/remember-mcp-vscode/workflows/CI/badge.svg)](https://github.com/NiclasOlofsson/remember-mcp-vscode/actions)
[![Tests](https://github.com/NiclasOlofsson/remember-mcp-vscode/workflows/Tests/badge.svg)](https://github.com/NiclasOlofsson/remember-mcp-vscode/actions)
[![Coverage](https://codecov.io/gh/NiclasOlofsson/remember-mcp-vscode/branch/main/graph/badge.svg)](https://codecov.io/gh/NiclasOlofsson/remember-mcp-vscode)

### 👨‍💻 For Contributors

- Clone this repository: `git clone https://github.com/NiclasOlofsson/remember-mcp-vscode.git`
- Run `npm install` to install dependencies  
- Press `F5` to launch the extension in development mode
- See `CONTRIBUTING.md` for detailed development guidelines
- Run `npm test` to execute tests
- Run `npm run lint` to check code style

### 📁 Project Structure
```
src/
├── extension.ts      # Main extension entry point
├── test/            # Test files
└── ...
```

### 🚀 Release Process
1. Run `npm run package:marketplace` to create VSIX with marketplace README
2. Test the VSIX locally: `code --install-extension remember-mcp-vscode-x.x.x.vsix`
3. Run `npm run publish:marketplace` to publish to marketplace
<!-- MARKETPLACE-EXCLUDE-END -->

Welcome to **Remember MCP**, the VS Code extension that brings real, persistent memory to your AI assistant and your team. Instantly store preferences, facts, and best practices—so Copilot always knows your context, and your team's knowledge is never lost.<source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/NiclasOlofsson/mode-manager-mcp/refs/heads/main/remember-new-logo-complete-white.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/NiclasOlofsson/mode-manager-mcp/refs/heads/main/remember-new-logo-complete-black.svg">
  <img alt="GitHub Copilot Memory Tool" src="https://raw.githubusercontent.com/NiclasOlofsson/remember-mcp-vscode/refs/heads/main/media/remember-new-logo-complete-black.png" width="800">
</picture>


# Meet Remember MCP – Real Memory for VS Code & Your AI

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/nickeolofsson.remember-mcp-vscode?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=nickeolofsson.remember-mcp-vscode)


Welcome to **Remember MCP**, the VS Code extension that brings real, persistent memory to your AI assistant and your team. Instantly store preferences, facts, and best practices—so Copilot always knows your context, and your team’s knowledge is never lost.

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

## Usage

### Quick Start
1. Install the extension and requirements
2. The MCP server will auto-register if enabled in settings
3. Use the "Remember MCP" activity bar to control registration
4. Access commands via the Command Palette (`Ctrl+Shift+P`):
   - `Remember MCP: Register MCP Server`
   - `Remember MCP: Unregister MCP Server`
   - `Remember MCP: Re-register MCP Server`
   - `Remember MCP: Show MCP Panel`

### Activity Bar Panel
Shows server status, quick actions, and interactive webview for server management.

### Status Bar
Displays current MCP server registration status:
- `$(server) MCP Running` - Server is registered
- `$(server) MCP Stopped` - Server is not registered
- `$(error) MCP Error` - Registration error
Click to open the MCP control panel.

## Power Prompts & Custom Modes

Context prompting is critical for getting the best results from Copilot. Remember MCP helps you manage instructions and chatmodes—switch between “Beast Mode” for deep research, “Architect Mode” for big-picture thinking, and more. Easily create, edit, and organize your own `.chatmode.md` and `.instructions.md` files.

## Configuration

Configure the extension through VS Code settings (`Ctrl+,`):
```json
{
  "remember-mcp.server.autoStart": true,
  "remember-mcp.server.command": "pipx run --system-site-packages --spec git+https://github.com/NiclasOlofsson/mode-manager-mcp.git mode-manager-mcp"
}
```
For custom installations, update the server command as needed.

## Troubleshooting

### Server Won't Register?
1. Ensure Python 3.10+ is installed: `python --version`
2. Check if pipx is available: `pipx --version`
3. Verify mode-manager-mcp is available: `pipx run mode-manager-mcp --help`
4. Check the Output panel for error messages
5. Ensure VS Code 1.102.0+ (MCP API support required)

## Development

### Building from Source
```bash
git clone https://github.com/NiclasOlofsson/remember-mcp-vscode
cd remember-mcp-vscode
npm install
npm run compile
```

### Running in Development
1. Open the project in VS Code
2. Press `F5` to launch a new Extension Development Host
3. Test the extension in the new window

## Related Projects & Links
- [mode-manager-mcp](https://github.com/NiclasOlofsson/mode-manager-mcp) – The MCP server this extension registers
- [Model Context Protocol](https://modelcontextprotocol.io/) – Learn more about MCP
- [VS Code MCP Documentation](https://code.visualstudio.com/api/references/vscode-api#lm) – VS Code MCP API reference


## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see the [LICENSE](LICENSE) file for details.
