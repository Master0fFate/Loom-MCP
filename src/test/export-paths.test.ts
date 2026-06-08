import test from "node:test";
import assert from "node:assert/strict";
import * as os from "os";
import * as path from "path";

import {
  createExportFilename,
  resolveExportPath,
  toExportSlug,
  validateExportFilename,
} from "../export-paths.js";

test("toExportSlug converts thread IDs into safe filename segments", () => {
  assert.equal(toExportSlug("task/with spaces"), "task-with-spaces");
  assert.equal(toExportSlug("../escape"), "escape");
  assert.equal(toExportSlug("CON"), "thread-CON");
  assert.equal(toExportSlug("   "), "thread");
});

test("createExportFilename emits a stable safe .jsonl filename", () => {
  const filename = createExportFilename("release smoke/thread", new Date("2026-06-08T12:34:56Z"));

  assert.equal(filename, "loom-release-smoke-thread-20260608123456000.jsonl");
  assert.equal(validateExportFilename(filename), filename);
});

test("resolveExportPath accepts filenames and absolute paths inside exports dir", () => {
  const exportsDir = path.join(os.tmpdir(), "loom-mcp-export-paths");
  const filename = "loom-thread-20260608123456.jsonl";
  const expected = path.join(path.resolve(exportsDir), filename);

  assert.equal(resolveExportPath(filename, exportsDir), expected);
  assert.equal(resolveExportPath(expected, exportsDir), expected);
});

test("resolveExportPath rejects traversal, nested paths, and unsafe Windows names", () => {
  const exportsDir = path.join(os.tmpdir(), "loom-mcp-export-paths");

  assert.throws(() => resolveExportPath("../loom.db", exportsDir), /plain \.jsonl filename|directly inside/);
  assert.throws(() => resolveExportPath("nested/loom-thread.jsonl", exportsDir), /plain \.jsonl filename|directly inside/);
  assert.throws(() => resolveExportPath("nested\\loom-thread.jsonl", exportsDir), /plain \.jsonl filename|directly inside/);
  assert.throws(() => resolveExportPath("CON.jsonl", exportsDir), /reserved Windows/);
  assert.throws(() => resolveExportPath("loom:thread.jsonl", exportsDir), /':'/);
});
