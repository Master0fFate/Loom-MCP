import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import process from "process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

function parseToolJson(result: ToolResult): Record<string, unknown> {
  const content = (result as { content?: unknown }).content;
  assert.ok(Array.isArray(content), "tool result should include content array");

  const textContent = content.find(
    (item): item is { type: "text"; text: string } =>
      typeof item === "object" &&
      item !== null &&
      (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string"
  );
  assert.ok(textContent, "tool result should include text content");

  const parsed = JSON.parse(textContent.text) as Record<string, unknown>;
  assert.deepEqual((result as { structuredContent?: unknown }).structuredContent, parsed);
  return parsed;
}

test("MCP stdio server supports the full Loom lifecycle", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-mcp-smoke-"));
  const serverPath = path.resolve("dist", "index.js");
  const threadId = `smoke-${Date.now()}`;

  const client = new Client({ name: "loom-mcp-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: {
      ...process.env,
      LOOM_DATA_DIR: dataDir,
      LOOM_WEAVE_THRESHOLD_TOKENS: "8",
    },
    stderr: "pipe",
  });

  t.after(async () => {
    await client.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await client.connect(transport);

  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name);
  assert.ok(toolNames.includes("loom_weave_block"));
  assert.ok(toolNames.includes("loom_export_memento_dataset"));
  assert.ok(toolNames.includes("loom_read_export"));

  const firstWeave = parseToolJson(
    await client.callTool({
      name: "loom_weave_block",
      arguments: {
        thread_id: threadId,
        raw_reasoning: "Investigated the product gap: users need a clear reason to install Loom-MCP.",
        summary: "Product gap identified: lead with persistent reasoning memory and exportable traces.",
      },
    })
  );
  assert.equal(firstWeave.status, "woven");
  assert.equal(firstWeave.block_index, 0);

  const secondWeave = parseToolJson(
    await client.callTool({
      name: "loom_weave_block",
      arguments: {
        thread_id: threadId,
        raw_reasoning: "Validated the flow through a real MCP stdio client instead of only unit tests.",
        summary: "Smoke test uses the SDK client over stdio to validate real integration.",
      },
    })
  );
  assert.equal(secondWeave.block_index, 1);

  const listThreads = parseToolJson(await client.callTool({ name: "loom_list_threads", arguments: {} }));
  const threads = listThreads.threads as { thread_id: string; block_count: number }[];
  assert.equal(threads.find((thread) => thread.thread_id === threadId)?.block_count, 2);

  const tapestry = parseToolJson(
    await client.callTool({ name: "loom_view_tapestry", arguments: { thread_id: threadId } })
  );
  assert.equal(tapestry.block_count, 2);
  assert.deepEqual(
    (tapestry.tapestry as { block_index: number }[]).map((block) => block.block_index),
    [0, 1]
  );

  const prune = parseToolJson(
    await client.callTool({
      name: "loom_prune_check",
      arguments: { thread_id: threadId, current_unwoven_text: "This is enough current context to trigger a recommendation." },
    })
  );
  assert.equal(prune.should_weave_now, true);

  const resource = await client.readResource({ uri: `loom://threads/${threadId}/stats` });
  const firstResource = resource.contents[0];
  assert.ok("text" in firstResource, "thread stats resource should return text JSON");
  const stats = JSON.parse(firstResource.text) as Record<string, unknown>;
  assert.equal(stats.thread_id, threadId);
  assert.equal(stats.block_count, 2);

  const exported = parseToolJson(
    await client.callTool({
      name: "loom_export_memento_dataset",
      arguments: { thread_id: threadId, final_output: "A customer-ready Loom-MCP release." },
    })
  );
  assert.equal(exported.status, "exported");
  assert.equal(exported.block_count, 2);
  assert.ok(String(exported.export_file).startsWith(dataDir));
  assert.equal(fs.existsSync(String(exported.export_file)), true);

  const readExport = parseToolJson(
    await client.callTool({
      name: "loom_read_export",
      arguments: { export_file: exported.export_filename },
    })
  );
  const record = readExport.record as { thread_id: string; block_count: number; output: string };
  assert.equal(record.thread_id, threadId);
  assert.equal(record.block_count, 2);
  assert.equal(record.output, "A customer-ready Loom-MCP release.");

  const traversal = await client.callTool({
    name: "loom_read_export",
    arguments: { export_file: "../loom.db" },
  });
  const traversalPayload = parseToolJson(traversal);
  assert.equal(traversal.isError, true);
  assert.equal(traversalPayload.code, "INVALID_EXPORT_PATH");

  const deleteAbort = await client.callTool({
    name: "loom_delete_thread",
    arguments: { thread_id: threadId, confirm: false },
  });
  assert.equal(deleteAbort.isError, true);
  assert.equal(parseToolJson(deleteAbort).code, "CONFIRMATION_REQUIRED");

  const deleted = parseToolJson(
    await client.callTool({
      name: "loom_delete_thread",
      arguments: { thread_id: threadId, confirm: true },
    })
  );
  assert.equal(deleted.deleted_blocks, 2);

  const afterDelete = parseToolJson(
    await client.callTool({ name: "loom_view_tapestry", arguments: { thread_id: threadId } })
  );
  assert.equal(afterDelete.block_count, 0);
});
