# Changelog

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
