# Security Policy

## Security model

Loom-MCP is a local-first MCP server.

- It stores data in local SQLite under `LOOM_DATA_DIR` or `~/.loom-mcp`.
- It does not run a network listener by default; the server uses MCP stdio transport.
- It does not implement authentication, team permissions, remote sync, encryption-at-rest, or compliance retention controls.
- It treats export reads as local file access constrained to the Loom exports directory.

## Sensitive data warning

`raw_reasoning`, summaries, and exported JSONL records can contain secrets, credentials, customer data, or personal data if an agent writes them. Keep sensitive material out of Loom, or store `LOOM_DATA_DIR` in a protected location.

## Hardening included

- Tool input schemas limit empty and oversized values.
- Export filenames are sanitized before writes.
- `loom_read_export` rejects traversal, nested paths, unsafe filenames, and files outside the exports directory.
- `loom_delete_thread` requires `confirm: true` and reports that deletion is irreversible.
- SQLite uses WAL mode, foreign keys, busy timeout, and transactional block inserts.
- Dependency audit is part of release verification.

## Reporting vulnerabilities

Open a GitHub issue at https://github.com/Master0fFate/Loom-MCP/issues with:

- A concise description of the vulnerability.
- Reproduction steps.
- Expected and actual behavior.
- Environment details: OS, Node version, Loom-MCP version, and MCP client.

Do not include live secrets or private user data in public reports.
