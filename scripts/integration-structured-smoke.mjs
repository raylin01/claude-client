#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { ClaudeClient } from '../dist/esm/index.js';

const OUTPUT_DIR = join(process.cwd(), 'test-output');
const OUTPUT_FILE = join(OUTPUT_DIR, 'structured-smoke-result.json');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function short(text, max = 160) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

async function collectUpdates(turn, onRequest) {
  const updates = [];

  for await (const update of turn.updates()) {
    updates.push(update);
    const snapshot = update.snapshot;
    console.log(`[update:${update.kind}] status=${snapshot.status} output=${snapshot.currentOutputKind} text=${short(snapshot.text)} thinking=${short(snapshot.thinking)}`);

    const openRequests = snapshot.openRequests;
    for (const request of openRequests) {
      if (request.status === 'open') {
        await onRequest(request);
      }
    }
  }

  return updates;
}

async function waitForTurn(turn, timeoutMs) {
  return await Promise.race([
    turn.done,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms waiting for turn ${turn.current().id}`)), timeoutMs);
    })
  ]);
}

async function main() {
  const client = await ClaudeClient.init({
    cwd: process.cwd(),
    debug: true,
    permissionPromptTool: true,
    includePartialMessages: true,
    permissionMode: 'default'
  });

  const handledRequests = new Set();
  const requestLog = [];

  async function handleRequest(request) {
    if (handledRequests.has(request.id)) {
      return;
    }

    handledRequests.add(request.id);
    requestLog.push({ id: request.id, kind: request.kind, toolName: request.toolName || null });

    if (request.kind === 'question') {
      console.log(`[request:question] ${request.prompt}`);
      await client.answerQuestion(request.id, ['beta']);
      return;
    }

    if (request.kind === 'tool_approval') {
      console.log(`[request:tool] ${request.toolName} input=${JSON.stringify(request.input)}`);
      await client.approveRequest(request.id, { message: 'Approved by structured smoke test.' });
      return;
    }

    if (request.kind === 'hook') {
      console.log('[request:hook] approving hook callback');
      await client.approveRequest(request.id, { message: 'Approved by structured smoke test.' });
      return;
    }

    throw new Error(`Unhandled request kind: ${request.kind}`);
  }

  console.log('Starting structured turn 1');
  const firstTurn = client.send(
    [
      'Use the AskUserQuestion tool before doing anything else.',
      'Ask exactly one question with header Choice and question Choose alpha or beta with options alpha and beta.',
      'After I answer, use Bash to run pwd in the current directory.',
      'Then respond with a short summary that includes the final chosen option and whether Bash succeeded.'
    ].join(' ')
  );

  const firstTurnUpdates = collectUpdates(firstTurn, handleRequest);
  const firstSnapshot = await waitForTurn(firstTurn, 180000);
  await firstTurnUpdates;

  console.log('First turn completed');
  console.log(JSON.stringify({
    status: firstSnapshot.status,
    outputKind: firstSnapshot.currentOutputKind,
    text: short(firstSnapshot.text, 240),
    toolUses: firstSnapshot.toolUses.map((tool) => ({ id: tool.id, name: tool.name })),
    toolResults: firstSnapshot.toolResults.map((result) => ({ toolUseId: result.toolUseId, isError: result.isError })),
    openRequests: firstSnapshot.openRequests,
    result: firstSnapshot.result
  }, null, 2));

  assert(firstSnapshot.status === 'completed', `First turn did not complete successfully: ${firstSnapshot.status}`);
  assert(requestLog.some((entry) => entry.kind === 'question'), 'Expected an AskUserQuestion request during turn 1.');
  assert(firstSnapshot.toolUses.some((tool) => tool.name === 'Bash'), 'Expected Bash tool use to be captured in turn 1.');
  assert(firstSnapshot.toolResults.some((result) => result.isError === false), 'Expected a successful tool result in turn 1.');
  assert(/beta/i.test(firstSnapshot.text) || /beta/i.test(firstSnapshot.result?.result || ''), 'Expected turn 1 output to mention beta.');

  if (!requestLog.some((entry) => entry.kind === 'tool_approval' && entry.toolName === 'Bash')) {
    console.log('No explicit Bash approval request was emitted in this environment; Bash still executed successfully.');
  }

  console.log('Starting structured turn 2');
  const secondTurn = client.send('In one short sentence, remind me which option I selected in the previous turn and mention whether Bash succeeded.');
  const secondTurnUpdates = collectUpdates(secondTurn, handleRequest);
  const secondSnapshot = await waitForTurn(secondTurn, 180000);
  await secondTurnUpdates;

  console.log('Second turn completed');
  console.log(JSON.stringify({
    status: secondSnapshot.status,
    outputKind: secondSnapshot.currentOutputKind,
    text: short(secondSnapshot.text, 240),
    result: secondSnapshot.result
  }, null, 2));

  assert(secondSnapshot.status === 'completed', `Second turn did not complete successfully: ${secondSnapshot.status}`);
  assert(/beta/i.test(secondSnapshot.text) || /beta/i.test(secondSnapshot.result?.result || ''), 'Expected turn 2 output to remember beta.');

  const history = client.getHistory();
  assert(history.length >= 2, `Expected at least 2 completed turns, received ${history.length}.`);

  client.close();
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_FILE, JSON.stringify({
    ok: true,
    requestLog,
    historyCount: history.length,
    firstTurn: {
      status: firstSnapshot.status,
      text: firstSnapshot.text,
      result: firstSnapshot.result,
      toolUses: firstSnapshot.toolUses,
      toolResults: firstSnapshot.toolResults
    },
    secondTurn: {
      status: secondSnapshot.status,
      text: secondSnapshot.text,
      result: secondSnapshot.result,
      toolUses: secondSnapshot.toolUses,
      toolResults: secondSnapshot.toolResults
    }
  }, null, 2));
  console.log(`Wrote smoke test result to ${OUTPUT_FILE}`);
  console.log('Structured Claude client smoke test passed.');
}

main().catch((error) => {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_FILE, JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  }, null, 2));
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});