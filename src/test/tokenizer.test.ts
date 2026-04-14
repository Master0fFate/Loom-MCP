import test from "node:test";
import assert from "node:assert/strict";
import { countTokens, fallbackCharsToTokens } from "../tokenizer.js";

test("countTokens returns 0 for empty input", () => {
  assert.equal(countTokens(""), 0);
});

test("countTokens returns a positive value for text", () => {
  assert.ok(countTokens("Loom MCP token counting test.") > 0);
});

test("fallbackCharsToTokens uses legacy approximation", () => {
  assert.equal(fallbackCharsToTokens(40), 10);
});
