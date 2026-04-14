import Database, { Database as BetterSQLiteDatabase } from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// Store the database in the user's home directory so it persists across restarts
const DATA_DIR = process.env.LOOM_DATA_DIR || path.join(os.homedir(), ".loom-mcp");
const DB_PATH = path.join(DATA_DIR, "loom.db");
const EXPORTS_DIR = path.join(DATA_DIR, "exports");

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(EXPORTS_DIR)) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

export { EXPORTS_DIR };

const db: BetterSQLiteDatabase = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Schema initialisation
db.exec(`
  CREATE TABLE IF NOT EXISTS blocks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id   TEXT    NOT NULL,
    block_index INTEGER NOT NULL,
    raw_reasoning TEXT  NOT NULL,
    summary     TEXT    NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_blocks_thread ON blocks(thread_id, block_index);
`);

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------

const stmtInsertBlock = db.prepare<{
  thread_id: string;
  block_index: number;
  raw_reasoning: string;
  summary: string;
}>(
  `INSERT INTO blocks (thread_id, block_index, raw_reasoning, summary)
   VALUES (@thread_id, @block_index, @raw_reasoning, @summary)`
);

const stmtMaxIndex = db.prepare<[string]>(
  `SELECT COALESCE(MAX(block_index), -1) AS max_idx FROM blocks WHERE thread_id = ?`
);

const stmtGetSummaries = db.prepare<[string]>(
  `SELECT block_index, summary FROM blocks WHERE thread_id = ? ORDER BY block_index ASC`
);

const stmtGetAllBlocks = db.prepare<[string]>(
  `SELECT block_index, raw_reasoning, summary FROM blocks WHERE thread_id = ? ORDER BY block_index ASC`
);

const stmtStats = db.prepare<[string]>(
  `SELECT
     COUNT(*)                          AS block_count,
     COALESCE(SUM(LENGTH(raw_reasoning)), 0) AS total_raw_chars,
     COALESCE(SUM(LENGTH(summary)), 0)       AS total_summary_chars
   FROM blocks WHERE thread_id = ?`
);

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

export interface Block {
  block_index: number;
  raw_reasoning: string;
  summary: string;
}

export interface ThreadStats {
  block_count: number;
  total_raw_chars: number;
  total_summary_chars: number;
}

export interface ThreadOverview {
  thread_id: string;
  block_count: number;
  first_created_at: number;
  last_created_at: number;
}

/**
 * Appends a new block to a thread and returns the assigned block index.
 */
export function insertBlock(
  thread_id: string,
  raw_reasoning: string,
  summary: string
): number {
  const row = stmtMaxIndex.get(thread_id) as { max_idx: number };
  const nextIndex = row.max_idx + 1;
  stmtInsertBlock.run({ thread_id, block_index: nextIndex, raw_reasoning, summary });
  return nextIndex;
}

/**
 * Returns an ordered list of { block_index, summary } for a thread.
 */
export function getSummaries(thread_id: string): { block_index: number; summary: string }[] {
  return stmtGetSummaries.all(thread_id) as { block_index: number; summary: string }[];
}

/**
 * Returns all blocks (raw + summary) for a thread.
 */
export function getAllBlocks(thread_id: string): Block[] {
  return stmtGetAllBlocks.all(thread_id) as Block[];
}

/**
 * Returns aggregate statistics for a thread.
 */
export function getStats(thread_id: string): ThreadStats {
  return stmtStats.get(thread_id) as ThreadStats;
}

const stmtListThreads = db.prepare(
  `SELECT
     thread_id,
     COUNT(*) AS block_count,
     MIN(created_at) AS first_created_at,
     MAX(created_at) AS last_created_at
   FROM blocks
   GROUP BY thread_id
   ORDER BY last_created_at DESC`
);

const stmtDeleteThread = db.prepare<[string]>(`DELETE FROM blocks WHERE thread_id = ?`);

/**
 * Returns all known threads with lightweight stats.
 */
export function listThreads(): ThreadOverview[] {
  return stmtListThreads.all() as ThreadOverview[];
}

/**
 * Deletes all blocks belonging to a thread and returns the number of rows removed.
 * Callers should enforce an explicit user confirmation before invoking this helper.
 */
export function deleteThread(thread_id: string): number {
  const result = stmtDeleteThread.run(thread_id);
  return result.changes;
}

export default db;
