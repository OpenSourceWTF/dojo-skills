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

### Official Sources
| Source | Registry File | Skills Count |
|--------|---------------|--------------|
| [anthropics/skills](https://github.com/anthropics/skills) | `official/anthropic.json` | 14 |
| [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) | `official/google.json` | 7 |
| [openai/codex](https://github.com/openai/codex) | `official/openai.json` | 6 |

### Community Sources
| Source | Registry File | Skills Count |
|--------|---------------|--------------|
| [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) | `community/awesome.json` | 12 |
| [obra/superpowers](https://github.com/obra/superpowers) | `community/awesome.json` | Included |
| [PatrickJS/awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules) | `community/cursor-rules.json` | 12 |
| [instructa/ai-prompts](https://github.com/instructa/ai-prompts) | `community/cursor-rules.json` | Included |
| [wong2/awesome-mcp-servers](https://github.com/wong2/awesome-mcp-servers) | `community/mcp-servers.json` | 15 |

### Last Updated
- **Date**: 2026-01-12
- **Total Skills**: 66

## License

MIT - See [LICENSE](LICENSE) for details.
