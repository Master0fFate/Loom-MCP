# Audit Report: Loom-MCP

---

## 1. AUDIT SUMMARY

### 1.1 Subject Identification

| Field | Value |
| :--- | :--- |
| **Subject** | Loom-MCP |
| **Type** | Software (MCP Server) |
| **Domain** | LLM Reasoning Management / Context Optimization |
| **Stated/Inferred Goal** | Enable recursive reasoning compaction via the Memento research architecture to manage long-form context. |
| **Primary Stakeholders** | AI Developers, LLM Application Architects, Researchers |
| **Audit Language** | English |

### 1.2 Executive Verdict

Loom-MCP is a technically sound and highly specialized implementation of the Memento reasoning-compaction framework for the Model Context Protocol (MCP). It successfully bridges the gap between academic research and actionable toolsets for agentic workflows. The code is clean, modular, and performant. However, its maturity is limited by a complete lack of automated testing and a reliance on naive tokenization heuristics that may misrepresent actual context savings.

### 1.3 Overall Grade

| Grade | Meaning |
| :---: | :--- |
| **A-** | Strong — achieves its goal with minor gaps |

**One-Line Justification:** Exceptional conceptual alignment and clean implementation, slightly marred by the absence of a testing suite and approximate metrics.

---

## 2. DIMENSIONAL ANALYSIS

### Dimension: Technical Architecture & Code Quality

- **Relevance:** Robust architecture ensures maintainability and scalability of the MCP server.
- **Findings:** The project utilizes TypeScript with a clear separation of concerns. Persistence is handled via `better-sqlite3` in a dedicated `db.ts` module, while the MCP protocol logic resides in `index.ts`. Use of Zod for schema validation ensures robust tool inputs.
- **Strengths:**
  - Clean modularity between database and protocol layers.
  - Strong typing via TypeScript.
  - Effective use of prepared statements to prevent SQL injection.
- **Weaknesses:**
  - Hardcoded character-to-token approximation (`chars / 4`).
  - Lack of environment-based configuration for the database path in a standard way (though `LOOM_DATA_DIR` exists).
- **Score:** 8/10

### Dimension: Functional Completeness

- **Relevance:** The server must provide all necessary tools to implement the Memento reasoning compaction lifecycle.
- **Findings:** The server implements the core workflow required for reasoning compaction: weaving blocks, viewing the tapestry, checking density, and exporting the final dataset.
- **Strengths:**
  - Implements the specific structural markers (`<|block_start|>`, etc.) from the Memento paper.
  - Provides a dynamic resource for real-time thread statistics.
- **Weaknesses:**
  - No mechanism for deleting or archiving old threads within the toolset.
  - Exported files are written to the local disk without a tool-based retrieval mechanism.
- **Score:** 8/10

### Dimension: Documentation & UX

- **Relevance:** Clear documentation is vital for both developers and the LLMs that will interact with the MCP tools.
- **Findings:** The README is comprehensive, providing clear installation, configuration, and usage instructions. Tool descriptions are helpful for the LLM using them.
- **Strengths:**
  - Excellent use of metaphors ("Warp" and "Weft") to explain complex concepts.
  - Clear "Usage Workflow" section.
- **Weaknesses:**
  - Lacks developer documentation for extending the server.
  - No examples of "good" vs "bad" warp summaries provided to guide the LLM.
- **Score:** 7/10

### Dimension: Reliability & Error Handling

- **Relevance:** As a middleware for reasoning, the server must handle errors gracefully to avoid breaking the LLM's chain of thought.
- **Findings:** The server uses standard MCP error patterns. It checks for the existence of blocks before allowing an export, which prevents malformed output.
- **Strengths:**
  - SQLite WAL mode enabled for better concurrency.
  - Validation of thread IDs and input lengths via Zod.
- **Weaknesses:**
  - No automated tests (unit or integration) were found in the repository.
  - Process exits on fatal errors in `main()` without attempting graceful recovery.
- **Score:** 6/10

### Dimensional Scorecard

| Dimension | Score (1–10) | Key Finding |
| :--- | :---: | :--- |
| Technical Architecture | 8 | Clean TypeScript/SQLite implementation. |
| Functional Completeness | 8 | Full Memento lifecycle support. |
| Documentation & UX | 7 | Strong metaphors; weak developer guides. |
| Reliability & Error Handling | 6 | **Critical Gap:** Zero automated tests. |
| **Weighted Average** | **7.3/10** | |

---

## 3. CRITICAL FINDINGS

### Critical Finding #1

- **What:** Total absence of automated testing suite.
- **Why It Matters:** Without unit or integration tests, future contributions or refactors are highly likely to introduce regressions in the reasoning compaction logic or database integrity.
- **Evidence:** Repository contains no `test` directory and no `npm test` script.
- **Severity:** 🔴 High

### Critical Finding #2

- **What:** Naive tokenization approximation in `charsToTokens`.
- **Why It Matters:** The core value proposition is "saving tokens." By using a hardcoded `Math.round(chars / 4)`, the reported savings may be significantly inaccurate for non-English text or models using different tokenizers (e.g., Llama 3 or Claude's specific tokenizer).
- **Evidence:** `src/index.ts` lines 23-25.
- **Severity:** 🟠 Medium

### Critical Finding #3

- **What:** Lack of Thread Management (CRUD) tools.
- **Why It Matters:** Over time, the SQLite database will grow indefinitely with no way for the LLM or user to manage, delete, or list existing threads via the MCP interface.
- **Evidence:** Tool definitions only allow for creation and retrieval of content within a thread.
- **Severity:** 🟡 Low

---

## 4. RECOMMENDATIONS

### Recommendation #1

- **Problem:** Absence of tests (Critical Finding #1).
- **Proposed Action:** Implement a test suite using `jest` or `vitest`. Add unit tests for `db.ts` (verifying index increments) and integration tests for the MCP tools.
- **Expected Outcome:** Increased codebase stability and confidence for future contributors.
- **Effort Estimate:** 🟡 Medium
- **Priority Rationale:** Foundational for software maturity and long-term maintenance.

### Recommendation #2

- **Problem:** Naive tokenization (Critical Finding #2).
- **Proposed Action:** Integrate a library like `gpt-tokenizer` or `tiktoken` to calculate actual token counts based on specific model encodings.
- **Expected Outcome:** Accurate reporting of context savings, providing users with real data instead of estimates.
- **Effort Estimate:** 🟢 Low
- **Priority Rationale:** Directly impacts the credibility of the tool's core metrics.

### Recommendation #3

- **Problem:** No thread management tools (Critical Finding #3).
- **Proposed Action:** Add `loom_list_threads` and `loom_delete_thread` tools to the MCP server.
- **Expected Outcome:** Improved utility for long-term users and better database hygiene.
- **Effort Estimate:** 🟢 Low
- **Priority Rationale:** Simple to implement but significantly improves the "server" aspect of the project.

### Recommendation #4

- **Problem:** Limited guidance for LLM summaries.
- **Proposed Action:** Update the `loom_weave_block` tool description or the README to include examples of high-density "Warp" summaries versus low-value ones.
- **Expected Outcome:** Better performance from the LLM when utilizing the system for reasoning compaction.
- **Effort Estimate:** 🟢 Low
- **Priority Rationale:** Low effort with high potential impact on the quality of generated data.

### Recommendation #5

- **Problem:** Local filesystem export dependency.
- **Proposed Action:** Add a tool `loom_read_export` that allows retrieving the content of a `.jsonl` export via the MCP protocol.
- **Expected Outcome:** Allows the LLM to verify its own exports and makes the system more "self-contained" for remote users.
- **Effort Estimate:** 🟢 Low
- **Priority Rationale:** Enhances the accessibility of the generated datasets.

---

## 5. COMPARATIVE CONTEXT

### Best-in-class benchmark

Compared to other MCP servers like the "Memory" server or standard "Filesystem" servers, Loom-MCP is uniquely positioned to handle **reasoning history** rather than just **fact storage**. It is a direct implementation of the Memento paper, making it a state-of-the-art utility for anyone trying to generate SFT data or manage ultra-long reasoning chains.

### Common pitfalls

- ✅ avoids "Statelessness" by using SQLite.
- ✅ avoids "Vague Tooling" by using strict Zod schemas.
- ⚠️ shares the common pitfall of "Local-First" assumptions which can limit cloud deployment.

### Missed opportunities

- **Multi-modal support:** Current implementation is text-only, missing opportunities for auditing or compacting reasoning about images or videos.
- **Remote Persistence:** Reliance on local SQLite prevents easy scaling or shared state across multiple agent instances in a cloud environment.

---

## 6. INFORMATION GAPS

| Missing Information | What It Would Enable |
| :--- | :--- |
| Real-world token usage data from Claude | Calibration of the tokenization heuristic. |
| User feedback on summary quality | Refining the advice given to the LLM for the "Warp" step. |

---

## 7. AUDIT METADATA

| Field | Value |
| :--- | :--- |
| **Audit Framework Version** | Universal Auditor General v2.0 |
| **Dimensions Evaluated** | 4 |
| **Recommendations Issued** | 5 |
| **Critical Findings** | 3 |
| **Confidence Level** | 🟢 High — Full source code access and documentation review. |
| **Limitations Disclosure** | No runtime performance profiling was conducted under high load. |

---

*Audit conducted: 2025-05-22*
*Auditor: Jules (Software Engineer AI)*
