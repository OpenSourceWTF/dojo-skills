# Dojo Skills Registry

> 🥋 The canonical skill registry for [Dojo](https://github.com/OpenSourceWTF/dojo) - a package manager for AI agent skills and workflows.

## Overview

This repository contains curated skill definitions for AI coding agents including:
- **Claude Code** (Anthropic)
- **Gemini CLI** (Google)
- **Cursor AI**
- **OpenAI Codex**
- **Qwen/Alibaba**
- **Community contributions**

Skills are distributed to all detected agent environments via Dojo's "Always-Sync" dual-write system.

## Registry Structure

```
registry/
├── official/           # Vendor-maintained skills
│   ├── anthropic.json  # Official Anthropic/Claude skills
│   ├── google.json     # Official Google/Gemini skills
│   └── openai.json     # Official OpenAI/Codex skills
├── community/          # Community-curated skills  
│   ├── awesome.json    # Curated community skills
│   └── mcp-servers.json# MCP server integrations
└── user/               # Gitignored, local-only mappings
    └── *.json
```

## Skill JSON Schema

Each skill entry follows this structure:

```json
{
  "skills": {
    "skill-id": {
      "name": "Display Name",
      "source": "github:org/repo/path",
      "aliases": ["alias1", "alias2"],
      "description": "Short description of what the skill does",
      "tags": ["category1", "category2"],
      "dependencies": ["@org/dep-skill"],
      "versions": {
        "1.0.0": "commit-hash",
        "latest": "main"
      }
    }
  }
}
```

### Field Descriptions

| Field | Required | Description |
|-------|----------|-------------|
| `name` | ✅ | Human-readable display name |
| `source` | ✅ | GitHub path: `github:owner/repo/path` |
| `aliases` | ✅ | Short names for quick lookup |
| `description` | ✅ | One-line description |
| `tags` | ✅ | Categories for filtering |
| `dependencies` | ❌ | Skills this depends on |
| `versions` | ❌ | Version-to-commit mapping |

## Resolution Logic

1. **Fully Qualified Names (FQN)**: `@anthropic/docx`, `@google/code-review`
2. **Short Name Search**: Searching `pdf` looks across all registry files
3. **Collision Handling**: Multiple matches prompt user to select FQN
4. **Priority Order**: Official > Community > User

## Usage with Dojo

```bash
# Install a skill
dojo learn @anthropic/frontend-design

# Search for skills
dojo search "testing"

# List installed skills
dojo list
```

## Skill Categories

### 📄 Document Processing
Skills for working with Office documents, PDFs, and file formats.

### 🎨 Design & Creative
Generative art, visual design, and creative coding skills.

### 💻 Development
Coding patterns, testing frameworks, and build tools.

### 🔌 MCP Integrations
Model Context Protocol server builders and tools.

### 🔧 Productivity
Workflows, automation, and communication skills.

## Contributing

1. Fork this repository
2. Add your skill to `registry/community/awesome.json`
3. Follow the JSON schema above
4. Submit a PR with:
   - Skill description
   - Source repository link
   - Example use cases

## Sources & Attribution

This registry incorporates skills from the following curated sources:

### By AI Environment Compatibility

| Source Repository | Compatible With | Registry File | Count |
|-------------------|-----------------|---------------|-------|
| [anthropics/skills](https://github.com/anthropics/skills) | Claude Code | `official/anthropic.json` | 17 |
| [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) | Gemini CLI | `official/google.json` | 7 |
| [gemini-cli-extensions/*](https://github.com/gemini-cli-extensions) | Gemini CLI | `official/google.json` | 3 |
| [openai/codex](https://github.com/openai/codex) | OpenAI Codex | `official/openai.json` | 6 |
| [obra/superpowers](https://github.com/obra/superpowers) | Claude Code | `community/awesome.json` | 2 |
| [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) | Claude, Codex, Gemini | `community/awesome.json` | 1 |
| [wshobson/agents](https://github.com/wshobson/agents) | Claude Code | `community/awesome.json` | 1 |
| [Prat011/awesome-llm-skills](https://github.com/Prat011/awesome-llm-skills) | Claude, Codex, Gemini, Qwen | `community/awesome.json` | 1 |
| [code-yeongyu/oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) | Claude, Codex, Gemini | `community/awesome.json` | 1 |
| Community skills | Claude Code | `community/awesome.json` | 11 |
| [PatrickJS/awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules) | Cursor AI | `community/cursor-rules.json` | 12 |
| [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) | MCP (All agents) | `community/mcp-servers.json` | 13 |
| [upstash/context7](https://github.com/upstash/context7) | MCP (All agents) | `community/mcp-servers.json` | 1 |
| [github/github-mcp-server](https://github.com/github/github-mcp-server) | MCP (All agents) | `community/mcp-servers.json` | 1 |
| Other MCP servers | MCP (All agents) | `community/mcp-servers.json` | 5 |

### Summary by Platform

| Platform | Skills |
|----------|--------|
| Claude Code | 31 |
| Gemini CLI | 10 |
| OpenAI Codex | 6 |
| Cursor AI | 12 |
| Cross-platform (Claude/Codex/Gemini) | 3 |
| MCP Servers (works with all) | 20 |
| **Total** | **82** |

### Last Updated
- **Date**: 2026-01-13
- **Total Skills**: 82

## License

MIT - See [LICENSE](LICENSE) for details.
