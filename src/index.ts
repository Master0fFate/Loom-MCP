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
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
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
import { countTokens, fallbackCharsToTokens } from "./tokenizer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
const WEAVE_THRESHOLD_TOKENS = parseInt(
  process.env.LOOM_WEAVE_THRESHOLD_TOKENS ?? "500",
  10
);

const server = new McpServer({
  name: "loom-mcp",
  version: "1.0.0",
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
    thread_id: z
      .string()
      .min(1)
      .describe(
        "Unique identifier for this reasoning thread. Use a consistent ID across all calls in one task."
      ),
    raw_reasoning: z
      .string()
      .min(1)
      .describe(
        "The full, unabridged reasoning text for this step ('The Weft'). Do not abbreviate – the entire analytical chain-of-thought belongs here."
      ),
    summary: z
      .string()
      .min(1)
      .describe(
        "A concise, information-dense summary of the raw reasoning ('The Warp'). This is the only part that will remain in active context."
      ),
  },
  async ({ thread_id, raw_reasoning, summary }) => {
    const blockIndex = insertBlock(thread_id, raw_reasoning, summary);
    const rawTokens = countTokens(raw_reasoning);
    const summaryTokens = countTokens(summary);
    const savedTokens = rawTokens - summaryTokens;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "woven",
              thread_id,
              block_index: blockIndex,
              raw_tokens_offloaded: rawTokens,
              summary_tokens_retained: summaryTokens,
              tokens_freed: Math.max(0, savedTokens),
              message: `Block ${blockIndex} woven successfully. ${Math.max(0, savedTokens)} tokens freed from active context.`,
            },
            null,
            2
          ),
        },
      ],
    };
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

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              thread_count: threads.length,
              threads,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "loom_delete_thread",
  "Deletes all blocks for a thread. Use for cleanup/archival after confirming the thread is no longer needed.",
  {
    thread_id: z.string().min(1).describe("Thread ID to delete."),
    confirm: z
      .boolean()
      .default(false)
      .describe("Safety flag. Must be true to confirm deletion."),
  },
  async ({ thread_id, confirm }) => {
    if (!confirm) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "aborted",
                thread_id,
                message: "Deletion aborted. Set confirm=true to delete this thread.",
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    const deletedBlocks = deleteThread(thread_id);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "deleted",
              thread_id,
              deleted_blocks: deletedBlocks,
            },
            null,
            2
          ),
        },
      ],
    };
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
    thread_id: z
      .string()
      .min(1)
      .describe("The thread ID whose tapestry (ordered Warp summaries) you want to view."),
  },
  async ({ thread_id }) => {
    const summaries = getSummaries(thread_id);

    if (summaries.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                thread_id,
                block_count: 0,
                message: "No blocks have been woven for this thread yet.",
                tapestry: [],
              },
              null,
              2
            ),
          },
        ],
      };
    }

    const tapestry = summaries.map((s) => ({
      block_index: s.block_index,
      warp_summary: s.summary,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              thread_id,
              block_count: summaries.length,
              tapestry,
            },
            null,
            2
          ),
        },
      ],
    };
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
    thread_id: z
      .string()
      .min(1)
      .describe("The thread ID to export."),
    final_output: z
      .string()
      .min(1)
      .describe(
        "The final, polished answer delivered to the user at the end of this reasoning session. This becomes the 'output' field in the SFT dataset entry."
      ),
  },
  async ({ thread_id, final_output }) => {
    const blocks = getAllBlocks(thread_id);

    if (blocks.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "error",
                message: `No blocks found for thread '${thread_id}'. Weave at least one block before exporting.`,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    // Build the Memento-format reasoning chain
    const reasoningChain = blocks
      .map((b) => formatMementoBlock(b.raw_reasoning, b.summary))
      .join("\n");

    // Build the SFT record
    const sftRecord = {
      id: uuidv4(),
      thread_id,
      exported_at: new Date().toISOString(),
      block_count: blocks.length,
      reasoning: reasoningChain,
      output: final_output,
    };

    // Write versioned JSONL file – use a compact numeric timestamp for safe filenames
    const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 15);
    const filename = `loom-${thread_id}-${timestamp}.jsonl`;
    const filepath = path.join(EXPORTS_DIR, filename);

    fs.writeFileSync(filepath, JSON.stringify(sftRecord) + "\n", "utf-8");

    const { rawTokens: totalRawTokens, summaryTokens: totalSummaryTokens } = getTokenTotals(blocks);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "exported",
              thread_id,
              export_file: filepath,
              block_count: blocks.length,
              total_raw_tokens: totalRawTokens,
              total_summary_tokens: totalSummaryTokens,
              compression_ratio:
                totalRawTokens > 0
                  ? (totalSummaryTokens / totalRawTokens).toFixed(3)
                  : "N/A",
              message: `Dataset exported to ${filepath}`,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "loom_read_export",
  "Reads a previously exported Loom JSONL file from the exports directory and returns its parsed content.",
  {
    export_file: z
      .string()
      .min(1)
      .describe("Export filename (e.g., loom-thread-123.jsonl) or full path inside the Loom exports directory."),
  },
  async ({ export_file }) => {
    const baseExportsPath = path.resolve(EXPORTS_DIR);
    const requestedPath = path.isAbsolute(export_file)
      ? path.resolve(export_file)
      : path.resolve(path.join(baseExportsPath, export_file));

    const inExportsDir =
      requestedPath === baseExportsPath || requestedPath.startsWith(`${baseExportsPath}${path.sep}`);

    if (!inExportsDir) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "error",
                message: "Export path is outside the Loom exports directory.",
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    if (!fs.existsSync(requestedPath)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "error",
                message: `Export file not found: ${requestedPath}`,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    const fileText = fs.readFileSync(requestedPath, "utf-8").trim();

    try {
      const parsed = JSON.parse(fileText);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "ok",
                export_file: requestedPath,
                record: parsed,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "error",
                export_file: requestedPath,
                message: "Export exists but could not be parsed as a single JSON object.",
                raw_jsonl: fileText,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
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
    thread_id: z
      .string()
      .min(1)
      .describe("The thread ID to analyse."),
    current_unweaved_chars: z
      .number()
      .int()
      .nonnegative()
      .describe(
        "Approximate character count of reasoning that has NOT yet been woven (i.e., still in active context). Used to calculate whether a weave is overdue."
      ),
    current_unweaved_text: z
      .string()
      .optional()
      .describe(
        "Optional raw text for the current unweaved reasoning. If provided, Loom will compute exact token count with the configured tokenizer."
      ),
  },
  async ({ thread_id, current_unweaved_chars, current_unweaved_text }) => {
    const stats = getStats(thread_id);

    const blocks = getAllBlocks(thread_id);
    const { rawTokens: wovenRawTokens, summaryTokens: wovenSummaryTokens } = getTokenTotals(blocks);
    const savedTokens = wovenRawTokens - wovenSummaryTokens;
    const unwovenTokens = current_unweaved_text
      ? countTokens(current_unweaved_text)
      : fallbackCharsToTokens(current_unweaved_chars);

    // Suggest weaving if unweaved reasoning exceeds the configured threshold
    const shouldWeave = unwovenTokens >= WEAVE_THRESHOLD_TOKENS;

    const recommendation = shouldWeave
      ? `RECOMMEND WEAVE: You have ~${unwovenTokens} unweaved tokens in active context. Call loom_weave_block now to free context space.`
      : `Context load is acceptable (~${unwovenTokens} unweaved tokens). No immediate weave required.`;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              thread_id,
              woven_blocks: stats.block_count,
              woven_raw_tokens: wovenRawTokens,
              woven_summary_tokens: wovenSummaryTokens,
              tokens_saved_by_loom: savedTokens,
              current_unweaved_tokens: unwovenTokens,
              current_unweaved_token_method: current_unweaved_text
                ? "model_tokenizer"
                : "chars_div_4_fallback",
              weave_threshold_tokens: WEAVE_THRESHOLD_TOKENS,
              should_weave_now: shouldWeave,
              recommendation,
            },
            null,
            2
          ),
        },
      ],
    };
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
