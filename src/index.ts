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
import { insertBlock, getSummaries, getAllBlocks, getStats, EXPORTS_DIR } from "./db.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Rough character-to-token approximation (GPT-style ~4 chars / token). */
function charsToTokens(chars: number): number {
  return Math.round(chars / 4);
}

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
    const rawTokens = charsToTokens(raw_reasoning.length);
    const summaryTokens = charsToTokens(summary.length);
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

    const stats = getStats(thread_id);
    const totalRawTokens = charsToTokens(stats.total_raw_chars);
    const totalSummaryTokens = charsToTokens(stats.total_summary_chars);

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
  },
  async ({ thread_id, current_unweaved_chars }) => {
    const stats = getStats(thread_id);

    const wovenRawTokens = charsToTokens(stats.total_raw_chars);
    const wovenSummaryTokens = charsToTokens(stats.total_summary_chars);
    const savedTokens = wovenRawTokens - wovenSummaryTokens;
    const unwovenTokens = charsToTokens(current_unweaved_chars);

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

    const wovenRawTokens = charsToTokens(stats.total_raw_chars);
    const wovenSummaryTokens = charsToTokens(stats.total_summary_chars);
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
