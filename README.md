# Remember MCP VS Code Extension

A Visual Studio Code extension that integrates the [mode-manager-mcp](https://github.com/NiclasOlofsson/mode-manager-mcp) server with VS Code's built-in MCP (Model Context Protocol) system. This extension automatically registers your MCP server with VS Code, making it available to Copilot and other AI features.

## Features

- **Native MCP Integration**: Registers your MCP server with VS Code's built-in MCP system
- **Automatic Discovery**: Copilot and AI features automatically discover and use your server
- **Visual Management**: Simple interface to register/unregister your MCP server
- **Real-time Status**: See registration status in the status bar and activity panel
- **Output Logging**: View registration logs and server information
- **Auto-registration**: Automatically register the server when VS Code launches
- **Activity Bar Integration**: Dedicated activity bar panel for MCP server control

## How It Works

This extension uses VS Code's official MCP API (`vscode.lm.registerMcpServerDefinitionProvider`) to:

1. **Register** your mode-manager-mcp server with VS Code
2. **VS Code automatically manages** the server lifecycle (starts/stops as needed)
3. **Copilot automatically discovers** and uses your memory and chat modes
4. **No manual process management** - VS Code handles everything!

## Requirements

- **VS Code 1.102.0+**: Required for MCP API support
- **Python 3.10+**: Required to run the mode-manager-mcp server
- **pipx**: Recommended for running the MCP server (`pip install pipx`)
- **mode-manager-mcp**: The Python MCP server package

### Installation

1. Install Python from [python.org](https://python.org/downloads)
2. Install pipx: `pip install pipx`
3. Install the MCP server: `pipx install mode-manager-mcp`
4. Install this extension from the VS Code marketplace

## Extension Settings

This extension contributes the following settings:

- `remember-mcp.server.autoStart`: Automatically register the MCP server when VS Code starts (default: `true`)
- `remember-mcp.server.command`: Command to run the MCP server (default: `"pipx run --system-site-packages --spec git+https://github.com/NiclasOlofsson/mode-manager-mcp.git mode-manager-mcp"`)
- `remember-mcp.server.pythonPath`: Path to Python executable (deprecated - use server.command instead)

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

The extension adds a "Remember MCP" panel to the activity bar that shows:

- **Server Status**: Current registration state with VS Code MCP system
- **Actions**: Quick buttons to register, unregister, re-register the server
- **Server Control Panel**: Interactive webview for server management

### Status Bar

The status bar shows the current MCP server registration status:
- `$(server) MCP Running` - Server is registered with VS Code
- `$(server) MCP Stopped` - Server is not registered  
- `$(error) MCP Error` - Registration encountered an error

Click the status bar item to open the MCP control panel.

## Commands

All commands are available through the Command Palette:

- **Register MCP Server**: Register the server with VS Code's MCP system
- **Unregister MCP Server**: Remove the server from VS Code's MCP system
- **Re-register MCP Server**: Unregister and re-register the server
- **Show MCP Panel**: Open the activity bar panel
- **Show Output**: Display the registration logs

## Configuration

Configure the extension through VS Code settings (`Ctrl+,`):

```json
{
  "remember-mcp.server.autoStart": true,
  "remember-mcp.server.command": "pipx run --system-site-packages --spec git+https://github.com/NiclasOlofsson/mode-manager-mcp.git mode-manager-mcp"
}
```

### Custom Server Commands

If you have a custom installation, update the server command:

```json
{
  "remember-mcp.server.command": "python -m mode_manager_mcp"
}
```

For stable release:
```json
{
  "remember-mcp.server.command": "pipx run mode-manager-mcp"
}
```

## Troubleshooting

### Server Won't Register

1. Ensure Python 3.10+ is installed: `python --version`
2. Check if pipx is available: `pipx --version`
3. Verify mode-manager-mcp is available: `pipx run mode-manager-mcp --help`
4. Check the Output panel for error messages
5. Ensure VS Code 1.102.0+ (MCP API support required)

### VS Code MCP System

The extension integrates with VS Code's native MCP system. Once registered:
- Your server appears in VS Code's MCP server list
- Copilot automatically discovers your memory and chat modes
- VS Code manages server lifecycle (no manual start/stop needed)
- All MCP communication happens through VS Code's system

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

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Related Projects

- [mode-manager-mcp](https://github.com/NiclasOlofsson/mode-manager-mcp) - The MCP server this extension registers
- [Model Context Protocol](https://modelcontextprotocol.io/) - Learn more about MCP
- [VS Code MCP Documentation](https://code.visualstudio.com/api/references/vscode-api#lm) - VS Code MCP API reference

## Release Notes

### 0.0.1

Initial release of Remember MCP VS Code Extension:
- Native VS Code MCP integration using official APIs
- Automatic MCP server registration with VS Code
- Activity bar integration for registration management
- Status bar monitoring
- Output logging for troubleshooting
- Auto-registration configuration
