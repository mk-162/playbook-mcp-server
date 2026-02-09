# Playbook MCP Server

MCP server that provides tools for accessing a Playbook — brand context, strategy, workflows, templates, and search.

## Installation

```bash
git clone https://github.com/mk-162/playbook-mcp-server.git
cd playbook-mcp-server
npm install
npm run build
```

## Usage

Set `PLAYBOOK_PATH` to your Playbook directory:

```bash
PLAYBOOK_PATH=/path/to/your-playbook node dist/index.js
```

Or pass as argument:

```bash
node dist/index.js /path/to/your-playbook
```

## MCP Configuration

Add to your `mcporter.json` or MCP client config:

```json
{
  "mcpServers": {
    "playbook": {
      "command": "node",
      "args": ["/path/to/playbook-mcp-server/dist/index.js"],
      "env": {
        "PLAYBOOK_PATH": "/path/to/your-playbook"
      }
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `get_context` | Get brand, strategy, or other context files |
| `list_workflows` | List available workflows/SOPs |
| `get_workflow` | Get a specific workflow |
| `list_templates` | List available templates |
| `get_template` | Get a specific template |
| `search_playbook` | Search across all Playbook content |

## Examples

```bash
# Get brand context
mcporter call playbook.get_context section=brand

# Search the playbook
mcporter call playbook.search_playbook query="pricing"

# List workflows
mcporter call playbook.list_workflows
```

## License

MIT
