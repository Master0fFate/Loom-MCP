# Loom-MCP

Local-first memory for long-running AI agents.

Loom-MCP gives Claude, OpenCode, Cursor, VS Code, and other MCP clients a small durable memory layer for reasoning work:

- Keep compact summaries of long analysis instead of losing the thread when context gets crowded.
- Resume a task by reading the ordered summary trail instead of reloading every raw note.
- Export a local JSONL reasoning artifact for review, audit, or SFT dataset preparation.

If you have ever come back to a long agent session and thought "what did we decide and why?", Loom-MCP is for that.

## What it does

Loom stores each reasoning step as two parts:

- Weft: the full raw reasoning block you want to persist locally.
- Warp: the concise summary the agent should keep in active context.

Those blocks are grouped by `thread_id`, persisted in SQLite, and can be exported in the Microsoft Memento block/summary marker format.

## Why install it?

Use Loom-MCP when you want one of these jobs done:

| Job | Loom workflow |
| --- | --- |
| Keep a long coding/research session coherent | Call `loom_weave_block` after major reasoning steps, then `loom_view_tapestry` before continuing. |
| Avoid context-window bloat | Call `loom_prune_check` with current notes to decide whether to compact now. |
| Resume a task tomorrow | Reuse the same `thread_id` and read the tapestry of summaries. |
| Preserve a local audit artifact | Export with `loom_export_memento_dataset`, then read/verify with `loom_read_export`. |
| Clean up old local memory | List threads, export anything important, then delete with explicit confirmation. |

## Install

Prerequisites:

- Node.js 20+
- npm 9+

```bash
git clone https://github.com/Master0fFate/Loom-MCP.git
cd Loom-MCP
npm install
npm test
```

`npm test` builds the server and runs unit tests plus a real MCP stdio smoke test.

## Configure an MCP client

Build first:

```bash
npm run build
```

Generic stdio server config:

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

Optional storage override:

```json
{
  "mcpServers": {
    "loom-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/Loom-MCP/dist/index.js"],
      "env": {
        "LOOM_DATA_DIR": "/absolute/path/to/loom-data"
      }
    }
  }
}
```

By default Loom stores data at `~/.loom-mcp/loom.db` and exports under `~/.loom-mcp/exports/`.

## Try it with MCP Inspector

```bash
npm run build
npx @modelcontextprotocol/inspector node dist/index.js
```

Then call the tools in this order:

1. `loom_weave_block`
2. `loom_view_tapestry`
3. `loom_prune_check`
4. `loom_export_memento_dataset`
5. `loom_read_export`

## Which tool should I use?

| Tool | Use it when | Key inputs |
| --- | --- | --- |
| `loom_weave_block` | You finished a reasoning step and want to save the raw block plus compact summary. | `thread_id`, `raw_reasoning`, `summary` |
| `loom_view_tapestry` | You need the ordered summary trail for a thread. | `thread_id` |
| `loom_prune_check` | You want a token-pressure recommendation before continuing. | `thread_id`, `current_unwoven_text` or `current_unwoven_chars` |
| `loom_list_threads` | You want to see known threads and block counts. | none |
| `loom_export_memento_dataset` | You are done and want a local JSONL export. | `thread_id`, `final_output` |
| `loom_read_export` | You want to verify or retrieve an export through MCP. | `export_file` from the export result |
| `loom_delete_thread` | You want to permanently remove a local thread. | `thread_id`, `confirm: true` |

Tool responses include JSON text for compatibility and `structuredContent` for MCP clients that read machine-native tool output.

## Example agent instruction

Give this to an agent that has Loom-MCP available:

```text
Use Loom-MCP for long tasks. Pick a stable thread_id for this task. After each major reasoning milestone, call loom_weave_block with the full reasoning block and a dense summary. Before continuing after a pause, call loom_view_tapestry. If current notes are getting long, call loom_prune_check. At the end, call loom_export_memento_dataset with the final answer.
```

See `examples/agent-playbook.md` for a fuller playbook.

## Export format

Exports are one-record JSONL files:

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

Export filenames are sanitized to stay directly inside the Loom exports directory.

## Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `LOOM_DATA_DIR` | `~/.loom-mcp` | SQLite database and export directory. Read at server startup. |
| `LOOM_TOKENIZER_MODEL` | `gpt-4o-mini` | Tokenizer model for `js-tiktoken`. Falls back to `cl100k_base`. |
| `LOOM_WEAVE_THRESHOLD_TOKENS` | `500` | Recommendation threshold used by `loom_prune_check`. |
| `LOOM_MAX_THREAD_ID_CHARS` | `200` | Max thread ID length. |
| `LOOM_MAX_RAW_REASONING_CHARS` | `200000` | Max raw reasoning block size per weave. |
| `LOOM_MAX_SUMMARY_CHARS` | `20000` | Max summary size per weave. |
| `LOOM_MAX_FINAL_OUTPUT_CHARS` | `100000` | Max final output size for exports. |
| `LOOM_MAX_EXPORT_READ_BYTES` | `10000000` | Max export size readable through MCP. |

## Local-first boundaries

Loom-MCP is local-first infrastructure, not a hosted compliance product.

- No remote service is contacted by Loom-MCP.
- No auth, team permissions, encryption-at-rest, or centralized retention policy is implemented.
- Raw reasoning and exports may contain secrets or personal data if the agent writes them. Keep sensitive data out or store `LOOM_DATA_DIR` somewhere protected.
- `loom_delete_thread` is irreversible unless you exported the thread first.

See `SECURITY.md` for the security model and reporting path.

## Development

```bash
npm test          # build + all tests + MCP smoke test
npm run smoke     # build + MCP stdio smoke test only
npm run pack:check
npm audit --audit-level=moderate
```

Current verification coverage includes:

- SQLite thread lifecycle tests.
- Tokenizer tests.
- Export filename/path hardening tests.
- Real MCP stdio lifecycle smoke test using the MCP TypeScript SDK client.

## Research grounding

Loom-MCP is inspired by research showing that external memory and compact summaries can improve long-horizon agent work without changing model weights:

- Microsoft Memento: block/summary markers for reasoning compaction.
- Reflexion: verbal memory from past trials improves later agent behavior.
- MemoryBank, LongMem, and MemGPT: long-term memory helps overcome fixed context windows.

More detail: `docs/RESEARCH.md`.

## License

MIT
