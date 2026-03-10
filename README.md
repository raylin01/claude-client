# @raylin01/claude-client

Node.js client for controlling the Claude Code CLI with stream-json I/O.

The package now supports two layers:

- `ClaudeClient.init(...)` for the structured, handle-based API
- `new ClaudeClient(...)` for the lower-level event-driven transport API

## Choosing An API

Use the structured API for most applications.

- Choose `ClaudeClient.init(...)` when you want a higher-level SDK with per-turn handles, pushed updates, open request tracking, and turn history.
- Choose `new ClaudeClient(...)` with `client.on(...)` when you already have an event-driven integration layer, need raw Claude protocol events, or want to stay close to the stream-json transport.

Both APIs remain supported. The structured API is built on top of the raw client rather than replacing it.

## Install

```bash
npm install @raylin01/claude-client
```

## Requirements

- Node.js 18+
- Claude CLI installed and authenticated (`claude login`)

## Quickstart

### Structured Mode (Recommended)

Structured mode gives you a `TurnHandle` for each send call. You get pushed updates, a current snapshot, open request tracking, and final completion without manually rebuilding state from raw events.

```ts
import { ClaudeClient } from '@raylin01/claude-client';

const client = await ClaudeClient.init({
  cwd: process.cwd(),
  includePartialMessages: true,
  permissionPromptTool: true
});

const turn = client.send('Summarize this project in one paragraph.');

for await (const update of turn.updates()) {
  if (update.kind === 'output' && update.snapshot.currentOutputKind === 'text') {
    process.stdout.write(`\r${update.snapshot.text}`);
  }

  for (const request of update.snapshot.openRequests) {
    if (request.status !== 'open') continue;

    if (request.kind === 'question') {
      await client.answerQuestion(request.id, ['beta']);
    } else if (request.kind === 'tool_approval') {
      await client.approveRequest(request.id, {
        message: 'Approved by README example.'
      });
    }
  }
}

const finalSnapshot = await turn.done;
console.log('\nDone:', finalSnapshot.result?.subtype);
client.close();
```

Structured mode exports these main capabilities:

- `client.send(input)` returns a live `TurnHandle`
- `turn.updates()` streams pushed updates for that turn
- `turn.current()` returns the latest snapshot
- `client.getOpenRequests()` returns unresolved tool or question requests
- `client.approveRequest(...)`, `client.denyRequest(...)`, and `client.answerQuestion(...)` respond at the structured level
- `client.createQuestionSession(requestId)` creates an incremental helper for multi-question prompts
- `client.getHistory()` returns completed turn snapshots

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

This raw event-driven pattern is still fully available and remains a good fit for repos that already normalize streaming and permissions in their own adapter layer.

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

The event model below applies to the lower-level raw client created with `new ClaudeClient(...)`.

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

### Structured API

#### `await ClaudeClient.init(config)`

Creates a `StructuredClaudeClient` backed by the existing Claude transport.

Main methods:

- `send(input, options?)`: returns a live `TurnHandle`
- `getCurrentTurn()`: latest active turn snapshot or `null`
- `getHistory()`: completed turn snapshots for the session
- `getOpenRequests()`: unresolved question, tool approval, hook, or MCP requests
- `getOpenRequest(id)`: fetch one open request by id
- `approveRequest(id, decision?)`: allow a tool or hook request
- `denyRequest(id, reason?)`: deny a tool or hook request
- `answerQuestion(id, answers)`: answer an `AskUserQuestion` request
- `createQuestionSession(id)`: incrementally collect answers for a question request, then `submit()` them
- `interruptTurn(turnId?)`: interrupt the active turn
- `setPermissionMode(mode)`, `setModel(model)`, `setMaxThinkingTokens(tokens)`
- `listSupportedModels(timeoutMs?)`
- `close()`

Question sessions let you step through multi-question prompts without assembling the final answer object up front:

```ts
const [request] = client.getOpenRequests();
if (request?.kind === 'question') {
  const session = client.createQuestionSession(request.id);

  session.setCurrentAnswer('Blue');
  session.next();
  session.setCurrentAnswer(['Cat', 'Dog']);

  await session.submit();
}
```

#### `TurnHandle`

Main methods and properties:

- `updates()`: async iterator of pushed turn updates
- `onUpdate(listener)`: subscribe to updates with an event listener
- `current()`: latest turn snapshot
- `history()`: semantic per-turn event history
- `getOpenRequests()`: unresolved requests for that turn
- `done`: promise resolving to the final turn snapshot

### `new ClaudeClient(config)`

Key config fields:

- `cwd` (required): working directory
- `claudePath`: custom CLI path
- `args`: extra CLI arguments
- `model`, `fallbackModel`, `maxTurns`, `maxBudgetUsd`
- `permissionMode`, `allowedTools`, `disallowedTools`
- `mcpServers`: MCP server configuration
- `worktree`: `true` for `--worktree`, or string name for `--worktree <name>`
- `tmux`: `true` for `--tmux`, or string mode like `classic`
- `systemPrompt`, `appendSystemPrompt`, `effort`
- `dangerouslySkipPermissions`, `allowDangerouslySkipPermissions`
- `debugMode`, `debugFile`, `verbose`
- `fromPr`, `chrome`, `ide`, `disableSlashCommands`
- `settings`, `extraArgs`, `sandbox`
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

- `basic.ts` - Structured mode basics
- `structured-requests.ts` - Structured request handling for AskUserQuestion and tool approvals
- `events.ts` - Lower-level raw event handling
- `error-handling.ts` - Error handling patterns
- `print-mode.ts` - Print mode with auto session ID
- `print-mode-session.ts` - Custom session ID and resumption across client instances

## Integration Scripts

Manual end-to-end scripts that run the real Claude CLI:

- `node scripts/integration-worktree-smoke.mjs`
- `node scripts/integration-tmux-smoke.mjs`
- `node scripts/integration-structured-smoke.mjs`
- `node scripts/integration-structured-multipass.mjs`

The structured integration scripts are intentionally pragmatic rather than perfectly deterministic. They are meant to validate that the JavaScript SDK works end to end with real Claude behavior, including streaming, questions, tool calls, and multi-turn memory, while persisting results to `test-output/` for inspection.

The current live validation shows that multi-turn memory, `AskUserQuestion`, streaming updates, and tool-use capture work through the structured API. Actual permission-prompt behavior can still vary by environment and Claude runtime configuration.

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
- If you are using the structured API, inspect `turn.current()` and `client.getOpenRequests()` before assuming the model stalled.
- If permission requests stall, ensure you handle `control_request`.
- In print mode, session ID is required for multi-turn conversations.

## Versioning

This package uses independent semver releases.

## License

ISC
