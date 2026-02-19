/**
 * Print Mode Example
 *
 * Print mode spawns a new process for each message but maintains session
 * persistence via --session-id (first message) and --resume (subsequent).
 *
 * Best for: Short queries, serverless environments, lower memory usage
 */

import { ClaudeClient } from '@raylin01/claude-client';

const client = new ClaudeClient({
  cwd: process.cwd(),
  printMode: true,
  model: 'claude-sonnet'
});

// In print mode, start() just emits 'ready' immediately - no process spawned yet
await client.start();

console.log('Session ID:', client.sessionId);
console.log('');

// Stream output events
client.on('text_delta', (text) => process.stdout.write(text));
client.on('thinking_delta', (thinking) => {
  process.stderr.write(`[Thinking] ${thinking}`);
});

client.on('result', (result) => {
  console.log('\n--- Result ---');
  console.log('Duration:', result.duration_ms, 'ms');
  console.log('Cost:', result.total_cost_usd?.toFixed(4) ?? 'N/A', 'USD');
});

// First message: uses --session-id <uuid>
console.log('=== First Message ===');
await client.sendMessage('What is 2+2? Just give me the number.');

// Wait a moment before next message
await new Promise(r => setTimeout(r, 500));

// Second message: uses --resume <session-id> - remembers context!
console.log('\n=== Second Message (resuming session) ===');
await client.sendMessage('What was the number from my previous question?');

console.log('\n=== Done ===');
