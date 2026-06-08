# Loom-MCP agent playbook

Use this when you want an agent to treat Loom-MCP as durable reasoning memory.

## Copyable instruction

```text
Use Loom-MCP during this task.

Thread ID: <choose-a-stable-thread-id>

Protocol:
1. After each major reasoning milestone, call loom_weave_block with:
   - raw_reasoning: the full reasoning block worth preserving locally
   - summary: a dense summary with decisions, assumptions, tradeoffs, and next step
2. Before continuing after a pause, call loom_view_tapestry for this thread_id.
3. If active notes are getting long, call loom_prune_check with current_unwoven_text.
4. When the task is complete, call loom_export_memento_dataset with the final answer.
5. Never store secrets, credentials, private keys, or sensitive customer data in raw_reasoning.
```

## Good Warp summaries

Good summaries preserve decisions and why they were made:

```text
Selected local SQLite over a remote service because Loom-MCP is local-first and stdio-only. Added path validation before export reads because MCP resources/tools must constrain local file access. Next step: verify with SDK client smoke test.
```

Weak summaries lose useful state:

```text
Worked on the database and tests. Continue.
```

## Suggested cadence

Call `loom_weave_block` after:

- A design decision.
- A failed debugging branch with a useful lesson.
- A completed implementation slice.
- A verification result that changes the plan.
- A user clarification that constrains the task.

Call `loom_view_tapestry` before:

- Resuming a paused task.
- Writing a final answer.
- Starting a risky refactor.
- Exporting the final record.

## Local audit artifact workflow

1. Use a stable `thread_id` for the task.
2. Weave important reasoning milestones.
3. Export when done.
4. Read the export back through `loom_read_export` to verify it.
5. Store or review the JSONL artifact according to your own local policy.

Reminder: Loom-MCP creates local artifacts only. It does not provide auth, compliance retention, or tamper-evident logs.
