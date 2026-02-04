# Claude Client (@discode/claude-client)

A standalone Node.js client for controlling the Claude Code CLI. This library allows you to programmatically interact with Claude, handling authentication, sessions, and tool use via a simple event-driven API.

## Installation

```bash
npm install @discode/claude-client
```

## Prerequisites

- Use `claude login` in your terminal to authenticate before using this library.
- Node.js 18+

## Basic Usage

```typescript
import { ClaudeClient } from "@discode/claude-client";

const client = new ClaudeClient({
    cwd: process.cwd(),
    debug: false,
});

// Event Handling
client.on("ready", () => {
    console.log("Connected to Claude CLI!");
    client.sendMessage("Hello, who are you?");
});

client.on("text_delta", (text) => {
    process.stdout.write(text);
});

client.on("thinking_delta", (thinking) => {
    // Handle thinking blocks (e.g. show a spinner or debug log)
    console.log("[Thinking]", thinking);
});

client.on("message", (msg) => {
    console.log("\nResponse Complete");
});

// Permissions / Control Requests
client.on("control_request", async (req) => {
    console.log("Permission requested:", req.request.subtype);

    // Automatically approve tool use for demo
    if (req.request.subtype === "can_use_tool") {
        await client.sendControlResponse(req.request_id, {
            behavior: "allow",
        });
    }
});

// Start the session
await client.start();
```

## API Reference

### `ClaudeClient`

#### Configuration

- `cwd`: Working directory for the session.
- `claudePath`: (Optional) Path to `claude` binary.
- `env`: (Optional) Environment variables.
- `args`: (Optional) Extra CLI arguments.

#### Methods

- `start()`: Spawns the CLI process.
- `sendMessage(text)`: Sends a user message.
- `sendControlResponse(requestId, data)`: Responds to permission requests or questions.
- `kill()`: Terminates the process.

#### Events

- `ready`: Session initialized.
- `text_delta`: Real-time text output.
- `thinking_delta`: Real-time thinking output.
- `message`: Full assistant message (when complete).
- `control_request`: Permission request (requires response).
- `error`: System error.

## License

ISC
