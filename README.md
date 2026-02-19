# @raylin01/claude-client

Node.js client for controlling the Claude Code CLI with stream-json I/O.

## Install

```bash
npm install @raylin01/claude-client
```

## Requirements

- Node.js 18+
- Claude CLI installed and authenticated (`claude login`)

## Quickstart

### Stream Mode (Default)

Persistent process with bidirectional JSON stream:

```ts
import { ClaudeClient } from '@raylin01/claude-client';

const client = new ClaudeClient({
  cwd: process.cwd(),
  debug: false
});

client.on('ready', () => {
  client.sendMessage('Summarize this project.');
});

client.on('text_delta', (text) => {
  process.stdout.write(text);
});

client.on('result', (result) => {
  console.log('\nDone:', result.subtype);
});

await client.start();
```

### Print Mode (One-shot)

Spawns a new process per message with session persistence via `--session-id`/`--resume`:

```ts
import { ClaudeClient } from '@raylin01/claude-client';

const client = new ClaudeClient({
  cwd: process.cwd(),
  printMode: true,  // Enable print mode
  model: 'claude-sonnet'
});

// No process spawned yet - ready fires immediately
await client.start();

client.on('text_delta', (text) => {
  process.stdout.write(text);
});

client.on('result', (result) => {
  console.log('\nSession ID:', client.sessionId);
});

// First message: uses --session-id <uuid>
await client.sendMessage('What is 2+2?');

// Subsequent messages: uses --resume <session-id>
await client.sendMessage('What was my previous question?');
```

### Print Mode with Custom Session ID

```ts
const client = new ClaudeClient({
  cwd: process.cwd(),
  printMode: true,
  sessionId: 'my-custom-session-id',  // Use your own session ID
  printModeAutoSession: false  // Disable auto-generation
});

await client.start();
await client.sendMessage('Hello!');
```

## Event Model

- `ready`: CLI process is ready
- `text_delta`: incremental assistant text output
- `thinking_delta`: incremental thinking output
- `text_accumulated`: running total of text output
- `thinking_accumulated`: running total of thinking output
- `message`: full assistant message object
- `tool_use_start`: tool execution started with parsed input
- `tool_result`: tool execution result
- `control_request`: permission/question callback from Claude
- `result`: turn completion event
- `status_change`: session status changed (running/idle/input_needed/error)
- `error`: transport/process error

## API

### `new ClaudeClient(config)`

Key config fields:

- `cwd` (required): working directory
- `claudePath`: custom CLI path
- `args`: extra CLI arguments
- `model`, `fallbackModel`, `maxTurns`, `maxBudgetUsd`
- `permissionMode`, `allowedTools`, `disallowedTools`
- `mcpServers`: MCP server configuration
- `thinking`: `{ maxTokens?, level? }` for extended thinking
- `debug`: enable debug logs
- `debugLogger`: optional custom logger callback

#### Print Mode Options

- `printMode`: Enable print mode (`-p` flag) - spawns process per message
- `printModeAutoSession`: Auto-generate session ID (default: `true` when printMode enabled)
- `sessionId`: Custom session ID to use

### Core methods

- `start()`: Start the CLI process (or just emit ready in print mode)
- `sendMessage(text)`: Send a text message
- `sendMessageWithContent(content)`: Send message with multiple content blocks
- `queueMessage(text)`: Queue message to send when Claude is ready
- `sendControlResponse(requestId, response)`: Respond to permission/question
- `sendControlRequest(request, timeoutMs?)`: Send control request
- `setModel(model)`: Change model mid-session
- `setPermissionMode(mode)`: Set permission mode
- `setMaxThinkingTokens(maxTokens)`: Configure thinking tokens
- `listSupportedModels()`: Get available models
- `interrupt()`: Interrupt current operation
- `kill()`: Terminate the session

### Getters

- `sessionId`: Current session ID
- `getStatus()`: Current status (`running` | `idle` | `input_needed` | `error`)
- `getPendingAction()`: Pending permission/question requiring input
- `isProcessing()`: Whether currently processing a message

### Utility exports

- `@raylin01/claude-client/sessions`
- `@raylin01/claude-client/mcp`
- `@raylin01/claude-client/task-store`
- `@raylin01/claude-client/task-queue`

## Examples

See `/examples`:

- `basic.ts` - Stream mode basics
- `events.ts` - Event handling (tool use, control requests)
- `error-handling.ts` - Error handling patterns
- `print-mode.ts` - Print mode with auto session ID
- `print-mode-session.ts` - Custom session ID and resumption across client instances

## Mode Comparison

| Feature | Stream Mode | Print Mode |
|---------|-------------|------------|
| Process lifecycle | Persistent | Spawn per message |
| Session persistence | In-memory | Disk-based via `--resume` |
| Memory usage | Higher | Lower (process exits) |
| Latency | Lower | Higher (spawn overhead) |
| Best for | Long-running sessions | Short queries, serverless |

## Projects Using This Client

- [DisCode](https://github.com/raylin01/DisCode) - Discord bot for AI pair programming
- [Squire](https://github.com/raylin01/squire) - AI assistant framework

## Troubleshooting

- If `ready` never fires, verify your `claude` binary path and authentication.
- Enable `debug: true` and provide `debugLogger` to inspect protocol events.
- If permission requests stall, ensure you handle `control_request`.
- In print mode, session ID is required for multi-turn conversations.

## Versioning

This package uses independent semver releases.

## License

ISC
