import test, { before } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

let dbModule: typeof import("../db.js");
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-mcp-test-"));

before(async () => {
  process.env.LOOM_DATA_DIR = testDataDir;
  dbModule = await import("../db.js");
});

test("insertBlock increments per thread", () => {
  const threadA = `thread-a-${Date.now()}-1`;
  const threadB = `thread-b-${Date.now()}-1`;

  const index0 = dbModule.insertBlock(threadA, "reasoning one", "summary one");
  const index1 = dbModule.insertBlock(threadA, "reasoning two", "summary two");
  const indexB0 = dbModule.insertBlock(threadB, "reasoning", "summary");

  assert.equal(index0, 0);
  assert.equal(index1, 1);
  assert.equal(indexB0, 0);
});

test("listThreads and deleteThread manage thread lifecycle", () => {
  const threadId = `thread-lifecycle-${Date.now()}`;

  dbModule.insertBlock(threadId, "raw a", "sum a");
  dbModule.insertBlock(threadId, "raw b", "sum b");

  const threads = dbModule.listThreads();
  const entry = threads.find((thread) => thread.thread_id === threadId);

  assert.ok(entry);
  assert.equal(entry?.block_count, 2);
  assert.ok(entry?.last_created_at >= entry?.first_created_at!);

  const deletedCount = dbModule.deleteThread(threadId);
  assert.equal(deletedCount, 2);

  const statsAfterDelete = dbModule.getStats(threadId);
  assert.equal(statsAfterDelete.block_count, 0);
});
