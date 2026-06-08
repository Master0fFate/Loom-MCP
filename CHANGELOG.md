# Changelog

## 1.1.1 - 2026-06-08

### Changed

- Token counting is now encoding-first instead of model-name-first.
- Default local tokenizer encoding changed to `o200k_base` with `cl100k_base` fallback.
- `LOOM_TOKENIZER_MODEL` remains as a backwards-compatible alias, but docs now recommend `LOOM_TOKENIZER_ENCODING`.
- README now explicitly states that tokenization is local and does not use an API key or hosted model.

## 1.1.0 - 2026-06-08

### Added

- Real MCP stdio smoke test using the MCP TypeScript SDK client.
- Structured MCP tool output (`structuredContent`) alongside JSON text fallback.
- Export filename/path validation with traversal and Windows reserved-name protection.
- Release metadata, npm pack hygiene, and customer-first README.
- Security model documentation and research grounding docs.

### Changed

- Package license metadata now matches the MIT license file.
- Server version now reports 1.1.0.
- Export filenames use sanitized thread slugs and millisecond-precision timestamps.
- SQLite writes use a transaction for block index allocation and insert.

### Fixed

- Removed direct vulnerable `uuid` dependency by using `crypto.randomUUID`.
- Added direct `zod` dependency instead of relying on MCP SDK transitive deps.
- Resolved npm audit findings through compatible dependency lock updates.

### Verification

- `npm test`
- `npm run smoke`
- `npm audit --audit-level=moderate`
- `npm run pack:check`
