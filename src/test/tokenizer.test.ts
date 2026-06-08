import test from "node:test";
import assert from "node:assert/strict";
import { countTokens, fallbackCharsToTokens, resolveTokenizerConfig } from "../tokenizer.js";

test("countTokens returns 0 for empty input", () => {
  assert.equal(countTokens(""), 0);
});

test("countTokens returns a positive value for text", () => {
  assert.ok(countTokens("Loom MCP token counting test.") > 0);
});

test("fallbackCharsToTokens uses legacy approximation", () => {
  assert.equal(fallbackCharsToTokens(40), 10);
});

test("resolveTokenizerConfig defaults to a local encoding, not a model name", () => {
  assert.deepEqual(resolveTokenizerConfig({}), { kind: "encoding", value: "o200k_base" });
});

test("resolveTokenizerConfig supports explicit local encodings", () => {
  assert.deepEqual(resolveTokenizerConfig({ LOOM_TOKENIZER_ENCODING: "cl100k_base" }), {
    kind: "encoding",
    value: "cl100k_base",
  });
});

test("resolveTokenizerConfig keeps LOOM_TOKENIZER_MODEL as a legacy alias", () => {
  assert.deepEqual(resolveTokenizerConfig({ LOOM_TOKENIZER_MODEL: "gpt-4o" }), {
    kind: "model",
    value: "gpt-4o",
  });
});

test("resolveTokenizerConfig falls back for unknown tokenizer settings", () => {
  assert.deepEqual(resolveTokenizerConfig({ LOOM_TOKENIZER_ENCODING: "unknown" }), {
    kind: "fallback",
    value: "cl100k_base",
  });
});
