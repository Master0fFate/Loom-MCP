# Research grounding

Loom-MCP is product infrastructure built around a simple idea: long-running agents need durable, compact memory outside the active context window.

## Model Context Protocol

MCP standardizes how AI applications connect to tools, resources, and workflows. Loom-MCP uses stdio transport and exposes model-controlled tools for storing, summarizing, reading, exporting, and deleting local reasoning memory.

Relevant MCP design implications:

- Tools should validate inputs and return clear tool execution errors with `isError` for recoverable user/tool failures.
- Structured tool output helps MCP-native clients compose results without parsing prose.
- Resources should validate URIs and avoid exposing files outside the intended boundary.

## Memento-style compaction

Microsoft Memento structures reasoning as raw blocks plus summaries:

```text
<think>
<|block_start|>raw reasoning<|block_end|>
<|summary_start|>compact summary<|summary_end|>
</think>
```

Loom-MCP adapts that structure as an MCP-accessible local memory and export format. It does not implement KV-cache masking; it gives agents a practical way to externalize and retrieve block/summary traces today.

## Related memory research

- Reflexion: language agents can improve from verbal feedback stored in episodic memory rather than gradient updates.
- MemoryBank: long-term memory helps agents remember prior interactions and update memory over time.
- LongMem: long-form memory addresses fixed context windows by caching/retrieving past context.
- MemGPT: virtual context management treats LLM context like a managed memory hierarchy.
- Memento: memory-based online adaptation and case retrieval can improve agent behavior without fine-tuning the base model.

## Product translation

The research points to a concrete developer workflow:

1. Persist the full reasoning block locally when it matters.
2. Keep only the dense summary in active context.
3. Retrieve the ordered summary trail when resuming work.
4. Export the full trace when the task is complete.

That is the core of Loom-MCP.

## Sources

- MCP intro: https://modelcontextprotocol.io/docs/getting-started/intro
- MCP tools: https://modelcontextprotocol.io/docs/concepts/tools
- MCP resources: https://modelcontextprotocol.io/docs/concepts/resources
- Microsoft Memento: https://github.com/microsoft/memento
- Reflexion: https://arxiv.org/abs/2303.11366
- MemoryBank: https://arxiv.org/abs/2305.10250
- LongMem: https://arxiv.org/abs/2306.07174
- MemGPT: https://arxiv.org/abs/2310.08560
- Memento agent memory paper: https://arxiv.org/abs/2508.16153
