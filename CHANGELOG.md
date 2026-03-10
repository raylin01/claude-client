# Changelog

## 0.3.3

- Added synthetic attached-turn handling so structured Claude clients can take over resumed waiting `control_request` prompts.
- Added regression coverage for answering provider-originated question requests without a locally started turn.

## 0.3.2

- Added shared provider-neutral session browser types for raw plus normalized transcript access.
- Added `listClaudeSessionSummaries(...)` and `readClaudeSessionRecord(...)` on top of the existing Claude filesystem session store.
- Added normalized Claude transcript extraction for text, thinking, tool use, tool results, plans, and pending approvals.
- Added session browser tests and optional locator overrides for Claude session discovery helpers.

## 0.3.1

- Added `createQuestionSession(...)` to the structured client for incremental multi-question workflows.
- Allowed structured Claude question answers to be keyed by question id as well as header/prompt labels.
- Updated tests and README examples for the new question helper.

## 0.3.0

- Added a new structured client layer via `ClaudeClient.init(...)`
- Added `TurnHandle`-based streaming with `updates()`, `current()`, `done`, and per-turn history
- Added structured open request handling for questions, tool approvals, hooks, and MCP requests
- Added high-level request helpers: `approveRequest`, `denyRequest`, and `answerQuestion`
- Added structured examples and updated the README to document when to use raw `client.on(...)` versus structured turns
- Added real Claude validation scripts for structured smoke tests and multi-pass live validation
- Expanded test coverage for the structured client surface while preserving the raw event API

## 0.2.0

- **New Feature**: Print mode (`printMode: true`) - spawns process per message with session persistence via `--session-id`/`--resume`
- `printModeAutoSession` option to auto-generate session IDs (default: true)
- Added comprehensive unit tests (46 total)
- Removed unused imports and dead code
- Added `queueMessage()` method for queuing messages when busy
- Added `getStatus()`, `getPendingAction()`, `isProcessing()` getters
- Added `text_accumulated`, `thinking_accumulated`, `tool_use_start`, `tool_result`, `status_change` events
- New examples: `print-mode.ts`, `print-mode-session.ts`
- Updated README with print mode documentation and mode comparison table

## 0.1.0

- Initial standalone public package release.
- Added dual ESM/CJS builds with typed exports.
- Added tests, examples, and expanded package documentation.
