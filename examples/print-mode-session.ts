/**
 * Print Mode with Custom Session ID
 *
 * Demonstrates using a custom session ID and resuming an existing session
 * across multiple client instances.
 */

import { ClaudeClient } from '@raylin01/claude-client';

// Custom session ID - could be stored in a database for later resumption
const SESSION_ID = 'my-project-session-abc123';

async function main() {
  // First client instance - starts a new session
  const client1 = new ClaudeClient({
    cwd: process.cwd(),
    printMode: true,
    sessionId: SESSION_ID,
    printModeAutoSession: false  // We're providing our own ID
  });

  await client1.start();

  client1.on('text_delta', (text) => process.stdout.write(text));
  client1.on('result', () => console.log('\n'));

  console.log('=== Client 1: Starting session ===');
  console.log('Session ID:', client1.sessionId);
  console.log('');

  // Store some information in the conversation
  await client1.sendMessage('Remember that my favorite color is blue.');

  // Simulate some time passing and a new client instance
  console.log('\n--- Time passes, new client instance ---\n');

  // Second client instance - resumes the same session
  const client2 = new ClaudeClient({
    cwd: process.cwd(),
    printMode: true,
    sessionId: SESSION_ID,
    printModeAutoSession: false
  });

  await client2.start();

  client2.on('text_delta', (text) => process.stdout.write(text));
  client2.on('result', () => console.log('\n'));

  console.log('=== Client 2: Resuming session ===');
  console.log('Session ID:', client2.sessionId);
  console.log('');

  // Ask about the stored information - Claude remembers!
  await client2.sendMessage('What is my favorite color?');

  console.log('=== Done ===');
}

main().catch(console.error);
