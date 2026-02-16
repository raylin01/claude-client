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

## Event Model

- `ready`: CLI process is ready
- `text_delta`: incremental assistant text output
- `thinking_delta`: incremental thinking output
- `message`: full assistant message object
- `control_request`: permission/question callback from Claude
- `result`: turn completion event
- `error`: transport/process error

## API

### `new ClaudeClient(config)`

Key config fields:

- `cwd` (required): working directory
- `claudePath`: custom CLI path
- `args`: extra CLI arguments
- `model`, `fallbackModel`, `maxTurns`, `maxBudgetUsd`
- `permissionMode`, `allowedTools`, `disallowedTools`
- `debug`: enable debug logs
- `debugLogger`: optional custom logger callback

### Core methods

- `start()`
- `sendMessage(text)`
- `sendMessageWithContent(content)`
- `sendControlResponse(requestId, response)`
- `sendControlRequest(request, timeoutMs?)`
- `setModel(model)`
- `setPermissionMode(mode)`
- `setMaxThinkingTokens(maxTokens)`
- `listSupportedModels()`
- `interrupt()`
- `kill()`

### Utility exports

- `@raylin01/claude-client/sessions`
- `@raylin01/claude-client/mcp`
- `@raylin01/claude-client/task-store`
- `@raylin01/claude-client/task-queue`

## Examples

See `/examples`:

- `basic.ts`
- `events.ts`
- `error-handling.ts`

## Troubleshooting

- If `ready` never fires, verify your `claude` binary path and authentication.
- Enable `debug: true` and provide `debugLogger` to inspect protocol events.
- If permission requests stall, ensure you handle `control_request`.

## Versioning

This package uses independent semver releases.

## Used by DisCode

DisCode uses this package as a real-world integration example:

- [raylin01/DisCode](https://github.com/raylin01/DisCode)

## License

ISC
