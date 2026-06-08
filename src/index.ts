#!/usr/bin/env node
/**
 * Loom-MCP – Recursive Reasoning Compaction MCP Server
 *
 * A high-performance MCP server inspired by the Microsoft Memento research
 * paper.  It allows an LLM to offload raw reasoning into persistent "Blocks,"
 * compress them into concise "Warp" summaries, and export the entire reasoning
 * trajectory as a Memento-spec SFT dataset.
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import {
  insertBlock,
  getSummaries,
  getAllBlocks,
  getStats,
  listThreads,
  deleteThread,
  EXPORTS_DIR,
} from "./db.js";
import { createExportFilename, ExportPathError, resolveExportPath } from "./export-paths.js";
import { countTokens, fallbackCharsToTokens } from "./tokenizer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JsonPayload = Record<string, unknown>;

function jsonToolResult(payload: JsonPayload, isError = false) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
    ...(isError ? { isError: true } : {}),
  };
}

function toolError(code: string, message: string, nextStep: string, details?: JsonPayload) {
  return jsonToolResult(
    {
      status: "error",
      code,
      message,
      next_step: nextStep,
      ...(details ? { details } : {}),
    },
    true
  );
}

function parsePositiveIntEnv(name: string, defaultValue: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

const MAX_THREAD_ID_CHARS = parsePositiveIntEnv("LOOM_MAX_THREAD_ID_CHARS", 200);
const MAX_RAW_REASONING_CHARS = parsePositiveIntEnv("LOOM_MAX_RAW_REASONING_CHARS", 200_000);
const MAX_SUMMARY_CHARS = parsePositiveIntEnv("LOOM_MAX_SUMMARY_CHARS", 20_000);
const MAX_FINAL_OUTPUT_CHARS = parsePositiveIntEnv("LOOM_MAX_FINAL_OUTPUT_CHARS", 100_000);
const MAX_EXPORT_READ_BYTES = parsePositiveIntEnv("LOOM_MAX_EXPORT_READ_BYTES", 10_000_000);

const threadIdSchema = z
  .string()
  .min(1)
  .max(MAX_THREAD_ID_CHARS)
  .refine((value) => value.trim().length > 0, "Thread ID cannot be blank.")
  .refine((value) => !/[\0\r\n]/.test(value), "Thread ID cannot contain null bytes or newlines.");

const rawReasoningSchema = z.string().min(1).max(MAX_RAW_REASONING_CHARS);
const summarySchema = z.string().min(1).max(MAX_SUMMARY_CHARS);
const finalOutputSchema = z.string().min(1).max(MAX_FINAL_OUTPUT_CHARS);

/**
 * Formats a reasoning block in the Memento structural marker format.
 *
 *   <think>
 *   <|block_start|>…<|block_end|>
 *   <|summary_start|>…<|summary_end|>
 *   </think>
 */
function formatMementoBlock(raw_reasoning: string, summary: string): string {
  return (
    "<think>\n" +
    `<|block_start|>${raw_reasoning}<|block_end|>\n` +
    `<|summary_start|>${summary}<|summary_end|>\n` +
    "</think>"
  );
}

function getTokenTotals(blocks: { raw_reasoning: string; summary: string }[]): {
  rawTokens: number;
  summaryTokens: number;
} {
  return blocks.reduce(
    (totals, block) => {
      totals.rawTokens += countTokens(block.raw_reasoning);
      totals.summaryTokens += countTokens(block.summary);
      return totals;
    },
    { rawTokens: 0, summaryTokens: 0 }
  );
}

/** Token threshold above which loom_prune_check will recommend a weave (~2000 chars). */
const WEAVE_THRESHOLD_TOKENS = parsePositiveIntEnv("LOOM_WEAVE_THRESHOLD_TOKENS", 500);

const server = new McpServer({
  name: "loom-mcp",
  version: "1.1.1",
});

// ---------------------------------------------------------------------------
// Server definition
// ---------------------------------------------------------------------------

/**
 * loom_weave_block
 * Saves a raw-reasoning block plus its concise summary ("Warp") to the
 * persistent store and returns a confirmation with the block index.
 */
server.tool(
  "loom_weave_block",
  "Call this when your current analytical step is complete. It saves your raw reasoning ('The Weft') and a mandatory concise summary ('The Warp'). This clears your cognitive load for the next step.",
  {
    thread_id: threadIdSchema.describe(
      "Unique identifier for this reasoning thread. Use a consistent ID across all calls in one task."
    ),
    raw_reasoning: rawReasoningSchema.describe(
      "The full reasoning text for this step ('The Weft'). Keep secrets out; this is persisted locally."
    ),
    summary: summarySchema.describe(
      "A concise, information-dense summary of the raw reasoning ('The Warp'). This is the compact context to keep active."
    ),
  },
  async ({ thread_id, raw_reasoning, summary }) => {
    const blockIndex = insertBlock(thread_id, raw_reasoning, summary);
    const rawTokens = countTokens(raw_reasoning);
    const summaryTokens = countTokens(summary);
    const savedTokens = rawTokens - summaryTokens;

    return jsonToolResult({
      status: "woven",
      thread_id,
      block_index: blockIndex,
      raw_tokens_offloaded: rawTokens,
      summary_tokens_retained: summaryTokens,
      tokens_freed: Math.max(0, savedTokens),
      message: `Block ${blockIndex} woven successfully. ${Math.max(0, savedTokens)} tokens freed from active context.`,
    });
  }
);

server.tool(
  "loom_list_threads",
  "Lists all known reasoning threads and their block counts so you can manage long-term storage.",
  {},
  async () => {
    const threads = listThreads().map((thread) => ({
      thread_id: thread.thread_id,
      block_count: thread.block_count,
      first_created_at: new Date(thread.first_created_at * 1000).toISOString(),
      last_created_at: new Date(thread.last_created_at * 1000).toISOString(),
    }));

    return jsonToolResult({
      thread_count: threads.length,
      threads,
    });
  }
);

server.tool(
  "loom_delete_thread",
  "Deletes all blocks for a thread. Use for cleanup/archival after confirming the thread is no longer needed.",
  {
    thread_id: threadIdSchema.describe("Thread ID to delete."),
    confirm: z
      .boolean()
      .default(false)
      .describe("Safety flag. Must be true to confirm deletion."),
  },
  async ({ thread_id, confirm }) => {
    if (!confirm) {
      return jsonToolResult(
        {
          status: "aborted",
          code: "CONFIRMATION_REQUIRED",
          thread_id,
          message: "Deletion aborted. Set confirm=true to permanently delete this local thread.",
          next_step: "Call loom_export_memento_dataset first if you need a recoverable artifact.",
        },
        true
      );
    }

    const deletedBlocks = deleteThread(thread_id);

    return jsonToolResult({
      status: "deleted",
      thread_id,
      deleted_blocks: deletedBlocks,
      message: "Thread deletion is irreversible unless you exported the thread first.",
    });
  }
);

/**
 * loom_view_tapestry
 * Returns all Warp summaries for a thread in chronological order, giving
 * the LLM a compact, high-fidelity view of its reasoning history.
 */
server.tool(
  "loom_view_tapestry",
  "Retrieves the sequential list of all previous 'Warp' summaries for the current thread. Use this to maintain context without re-reading massive reasoning blocks.",
  {
    thread_id: threadIdSchema.describe(
      "The thread ID whose tapestry (ordered Warp summaries) you want to view."
    ),
  },
  async ({ thread_id }) => {
    const summaries = getSummaries(thread_id);

    if (summaries.length === 0) {
      return jsonToolResult({
        thread_id,
        block_count: 0,
        message: "No blocks have been woven for this thread yet.",
        tapestry: [],
      });
    }

    const tapestry = summaries.map((s) => ({
      block_index: s.block_index,
      warp_summary: s.summary,
    }));

    return jsonToolResult({
      thread_id,
      block_count: summaries.length,
      tapestry,
    });
  }
);

/**
 * loom_export_memento_dataset
 * Finalises the session by packaging all blocks into Memento-spec JSONL,
 * versioned by timestamp, and written to the exports directory.
 */
server.tool(
  "loom_export_memento_dataset",
  "Finalizes the session. Aggregates all blocks into the Memento research format: <think><|block_start|>...<|block_end|><|summary_start|>...<|summary_end|></think>. Exports to a versioned .jsonl file for fine-tuning purposes.",
  {
    thread_id: threadIdSchema.describe("The thread ID to export."),
    final_output: finalOutputSchema.describe(
      "The final, polished answer delivered to the user at the end of this reasoning session. This becomes the 'output' field in the SFT dataset entry."
    ),
  },
  async ({ thread_id, final_output }) => {
    const blocks = getAllBlocks(thread_id);

    if (blocks.length === 0) {
      return toolError(
        "THREAD_EMPTY",
        `No blocks found for thread '${thread_id}'.`,
        "Call loom_weave_block at least once before exporting."
      );
    }

    // Build the Memento-format reasoning chain
    const reasoningChain = blocks
      .map((b) => formatMementoBlock(b.raw_reasoning, b.summary))
      .join("\n");

    // Build the SFT record
    const sftRecord = {
      id: randomUUID(),
      thread_id,
      exported_at: new Date().toISOString(),
      block_count: blocks.length,
      reasoning: reasoningChain,
      output: final_output,
    };

    // Write versioned JSONL file with a sanitized thread slug and compact timestamp.
    const filename = createExportFilename(thread_id);
    const filepath = resolveExportPath(filename, EXPORTS_DIR);

    fs.writeFileSync(filepath, JSON.stringify(sftRecord) + "\n", "utf-8");

    const { rawTokens: totalRawTokens, summaryTokens: totalSummaryTokens } = getTokenTotals(blocks);

    return jsonToolResult({
      status: "exported",
      thread_id,
      export_file: filepath,
      export_filename: filename,
      block_count: blocks.length,
      total_raw_tokens: totalRawTokens,
      total_summary_tokens: totalSummaryTokens,
      compression_ratio:
        totalRawTokens > 0 ? (totalSummaryTokens / totalRawTokens).toFixed(3) : "N/A",
      message: `Dataset exported to ${filepath}`,
    });
  }
);

server.tool(
  "loom_read_export",
  "Reads a previously exported Loom JSONL file from the exports directory and returns its parsed content.",
  {
    export_file: z
      .string()
      .min(1)
      .max(260)
      .describe("Export filename (e.g., loom-thread-123.jsonl) or full path inside the Loom exports directory."),
  },
  async ({ export_file }) => {
    let requestedPath: string;
    try {
      requestedPath = resolveExportPath(export_file, EXPORTS_DIR);
    } catch (error) {
      const message = error instanceof ExportPathError ? error.message : "Invalid export path.";
      return toolError(
        "INVALID_EXPORT_PATH",
        message,
        "Pass the export_filename returned by loom_export_memento_dataset, or an absolute path directly inside the Loom exports directory."
      );
    }

    if (!fs.existsSync(requestedPath)) {
      return toolError(
        "EXPORT_NOT_FOUND",
        `Export file not found: ${requestedPath}`,
        "List the files under your Loom exports directory or export the thread again."
      );
    }

    const fileStats = fs.statSync(requestedPath);
    if (!fileStats.isFile()) {
      return toolError(
        "EXPORT_NOT_FILE",
        `Export path is not a regular file: ${requestedPath}`,
        "Pass a .jsonl export file created by loom_export_memento_dataset."
      );
    }

    if (fileStats.size > MAX_EXPORT_READ_BYTES) {
      return toolError(
        "EXPORT_TOO_LARGE",
        `Export file is ${fileStats.size} bytes, above the configured ${MAX_EXPORT_READ_BYTES} byte read limit.`,
        "Increase LOOM_MAX_EXPORT_READ_BYTES if you intentionally need to read this file through MCP."
      );
    }

    const fileText = fs.readFileSync(requestedPath, "utf-8").trim();

    try {
      const parsed = JSON.parse(fileText);
      return jsonToolResult({
        status: "ok",
        export_file: requestedPath,
        record: parsed,
      });
    } catch {
      return toolError(
        "EXPORT_PARSE_FAILED",
        "Export exists but could not be parsed as a single JSON object.",
        "Regenerate the export, or inspect the file directly on disk.",
        { export_file: requestedPath, raw_jsonl: fileText }
      );
    }
  }
);

/**
 * loom_prune_check
 * Analyses the reasoning density of the current session and advises whether
 * it is time to call loom_weave_block to free up context tokens.
 */
server.tool(
  "loom_prune_check",
  "Utility tool that calculates the total 'reasoning density' of the current session. Suggests to the LLM when it is time to perform a weave_block to save context tokens.",
  {
    thread_id: threadIdSchema.describe("The thread ID to analyse."),
    current_unwoven_chars: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Approximate character count of reasoning that has NOT yet been woven (i.e., still in active context). Used when raw text is unavailable."
      ),
    current_unweaved_chars: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Deprecated alias for current_unwoven_chars."),
    current_unwoven_text: z
      .string()
      .optional()
      .describe(
        "Optional raw text for the current unweaved reasoning. If provided, Loom will compute exact token count with the configured tokenizer."
      ),
    current_unweaved_text: z
      .string()
      .optional()
      .describe("Deprecated alias for current_unwoven_text."),
  },
  async ({
    thread_id,
    current_unwoven_chars,
    current_unweaved_chars,
    current_unwoven_text,
    current_unweaved_text,
  }) => {
    const unwovenText = current_unwoven_text ?? current_unweaved_text;
    const unwovenChars = current_unwoven_chars ?? current_unweaved_chars;

    if (unwovenText === undefined && unwovenChars === undefined) {
      return toolError(
        "UNWOVEN_CONTEXT_REQUIRED",
        "Provide either current_unwoven_text (preferred) or current_unwoven_chars.",
        "Pass the raw unwoven reasoning text for exact token counting, or pass an approximate character count."
      );
    }

    const stats = getStats(thread_id);

    const blocks = getAllBlocks(thread_id);
    const { rawTokens: wovenRawTokens, summaryTokens: wovenSummaryTokens } = getTokenTotals(blocks);
    const savedTokens = wovenRawTokens - wovenSummaryTokens;
    const unwovenTokens = unwovenText !== undefined
      ? countTokens(unwovenText)
      : fallbackCharsToTokens(unwovenChars ?? 0);

    // Suggest weaving if unweaved reasoning exceeds the configured threshold
    const shouldWeave = unwovenTokens >= WEAVE_THRESHOLD_TOKENS;

    const recommendation = shouldWeave
      ? `RECOMMEND WEAVE: You have ~${unwovenTokens} unweaved tokens in active context. Call loom_weave_block now to free context space.`
      : `Context load is acceptable (~${unwovenTokens} unweaved tokens). No immediate weave required.`;

    return jsonToolResult({
      thread_id,
      woven_blocks: stats.block_count,
      woven_raw_tokens: wovenRawTokens,
      woven_summary_tokens: wovenSummaryTokens,
      tokens_saved_by_loom: savedTokens,
      current_unwoven_tokens: unwovenTokens,
      current_unwoven_token_method: unwovenText !== undefined ? "model_tokenizer" : "chars_div_4_fallback",
      weave_threshold_tokens: WEAVE_THRESHOLD_TOKENS,
      should_weave_now: shouldWeave,
      recommendation,
    });
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

/**
 * loom://threads/{thread_id}/stats
 * Dynamic resource showing token-count statistics for a given thread.
 */
server.resource(
  "thread-stats",
  new ResourceTemplate("loom://threads/{thread_id}/stats", { list: undefined }),
  async (uri, { thread_id }) => {
    const id = Array.isArray(thread_id) ? thread_id[0] : thread_id;
    const stats = getStats(id);

    const blocks = getAllBlocks(id);
    const { rawTokens: wovenRawTokens, summaryTokens: wovenSummaryTokens } = getTokenTotals(blocks);
    const savedTokens = wovenRawTokens - wovenSummaryTokens;
    const compressionRatio =
      wovenRawTokens > 0 ? (wovenSummaryTokens / wovenRawTokens).toFixed(3) : "N/A";

    const payload = {
      thread_id: id,
      block_count: stats.block_count,
      woven_raw_tokens: wovenRawTokens,
      woven_summary_tokens: wovenSummaryTokens,
      tokens_saved: savedTokens,
      compression_ratio: compressionRatio,
      description:
        "Tokens saved = raw reasoning tokens that were offloaded from active context via loom_weave_block, replaced by the concise Warp summaries.",
    };

    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so it doesn't interfere with the MCP stdio protocol
  process.stderr.write("Loom-MCP server started (stdio transport)\n");
}

main().catch((err) => {
  process.stderr.write(`Loom-MCP fatal error: ${err}\n`);
  process.exit(1);
});
