# Loom-MCP

**Loom-MCP is a reasoning-management engine derived from the Microsoft Memento research architecture. It facilitates the generation of high-quality reasoning traces and allows for manual context-window optimization in agentic workflows.**

An MCP server for **Recursive Reasoning Compaction** and SFT data generation. Built with the TypeScript MCP SDK and SQLite.

---

## Overview

Current LLMs suffer from "Reasoning Drift" and context saturation during complex, multi-step tasks. Loom-MCP solves this by providing a structured framework for compacting reasoning. It allows an LLM to:

1. **Offload** raw reasoning ("The Weft") into persistent "Blocks"
2. **Compress** each block into a concise summary ("The Warp")
3. **Export** the entire reasoning trajectory as a Memento-spec SFT (Supervised Fine-Tuning) dataset

The exported reasoning traces follow the structural markers from the [Microsoft Memento research paper](https://github.com/microsoft/memento):

```
<think>
<|block_start|>…raw reasoning…<|block_end|>
<|summary_start|>…concise summary…<|summary_end|>
</think>
```

---

## Tools

| Tool | Description |
|------|-------------|
| `loom_weave_block` | Saves a raw reasoning block and its concise Warp summary. Frees cognitive load for the next step. |
| `loom_view_tapestry` | Returns all Warp summaries in chronological order for a thread. |
| `loom_export_memento_dataset` | Finalizes the session and exports all blocks to a versioned `.jsonl` file in Memento format. |
| `loom_prune_check` | Calculates reasoning density and advises when to call `loom_weave_block`. |

## Resources

| URI | Description |
|-----|-------------|
| `loom://threads/{thread_id}/stats` | Dynamic resource showing token savings for a thread. |

---

## Installation

### Prerequisites

- Node.js 18+
- npm 9+

### Setup

```bash
git clone https://github.com/Master0fFate/Loom-MCP.git
cd Loom-MCP
npm install
npm run build
```

The server uses SQLite and stores its database at `~/.loom-mcp/loom.db` by default. Override this by setting the `LOOM_DATA_DIR` environment variable.

---

## Configuration

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "loom-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/Loom-MCP/dist/index.js"]
    }
  }
}
```

See also the included [`claude_desktop_config.json`](./claude_desktop_config.json) for a ready-to-use example.

---

## Usage Workflow

```
1. Start a new reasoning task → pick a thread_id (e.g., "task-2024-001")
2. Reason deeply → call loom_weave_block with your raw analysis + concise summary
3. Before the next step → call loom_view_tapestry to review prior summaries
4. Periodically → call loom_prune_check to gauge context pressure
5. When finished → call loom_export_memento_dataset to create the SFT record
```

---

## Data Format

Exported `.jsonl` files (stored in `~/.loom-mcp/exports/`) follow this schema:

```json
{
  "id": "<uuid>",
  "thread_id": "<thread_id>",
  "exported_at": "<ISO timestamp>",
  "block_count": 3,
  "reasoning": "<think>\n<|block_start|>...<|block_end|>\n<|summary_start|>...<|summary_end|>\n</think>",
  "output": "<final answer delivered to the user>"
}
```

---

