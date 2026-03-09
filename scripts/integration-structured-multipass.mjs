#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { ClaudeClient } from '../dist/esm/index.js';

const outputDir = join(process.cwd(), 'test-output');
const outputFile = join(outputDir, 'structured-multipass-result.json');

function short(value, max = 200) {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

async function waitForTurn(turn, timeoutMs) {
  return await Promise.race([
    turn.done,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${turn.current().id}`)), timeoutMs);
    })
  ]);
}

async function runScenario(name, prompt, requestHandler, timeoutMs = 180000) {
  const client = await ClaudeClient.init({
    cwd: process.cwd(),
    includePartialMessages: true,
    permissionPromptTool: true,
    permissionMode: 'default'
  });

  const handledRequests = new Set();
  const updates = [];
  const requests = [];
  const turn = client.send(prompt);

  const updateLoop = (async () => {
    for await (const update of turn.updates()) {
      updates.push({
        kind: update.kind,
        status: update.snapshot.status,
        outputKind: update.snapshot.currentOutputKind,
        text: short(update.snapshot.text),
        thinking: short(update.snapshot.thinking),
        openRequests: update.snapshot.openRequests.map((request) => ({
          id: request.id,
          kind: request.kind,
          toolName: request.kind === 'tool_approval' ? request.toolName : undefined,
          prompt: request.kind === 'question' ? request.prompt : undefined
        }))
      });

      for (const request of update.snapshot.openRequests) {
        if (request.status !== 'open' || handledRequests.has(request.id)) {
          continue;
        }

        handledRequests.add(request.id);
        requests.push({
          id: request.id,
          kind: request.kind,
          toolName: request.kind === 'tool_approval' ? request.toolName : undefined,
          prompt: request.kind === 'question' ? request.prompt : undefined
        });

        await requestHandler(client, request);
      }
    }
  })();

  try {
    const snapshot = await waitForTurn(turn, timeoutMs);
    await updateLoop;
    client.close();

    return {
      ok: true,
      name,
      requests,
      updates,
      snapshot: {
        status: snapshot.status,
        text: snapshot.text,
        thinking: short(snapshot.thinking),
        toolUses: snapshot.toolUses.map((tool) => ({ id: tool.id, name: tool.name })),
        toolResults: snapshot.toolResults.map((result) => ({
          toolUseId: result.toolUseId,
          isError: result.isError,
          content: short(result.content)
        })),
        result: snapshot.result
      }
    };
  } catch (error) {
    client.close();
    return {
      ok: false,
      name,
      requests,
      updates,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function runMemoryScenario() {
  const client = await ClaudeClient.init({
    cwd: process.cwd(),
    includePartialMessages: true,
    permissionPromptTool: true,
    permissionMode: 'default'
  });

  async function runTurn(prompt) {
    const turn = client.send(prompt);
    return await waitForTurn(turn, 120000);
  }

  try {
    const first = await runTurn('My smoke token is beta-42. Reply with exactly: stored beta-42');
    const second = await runTurn('What is my smoke token? Reply with exactly the token only.');
    const history = client.getHistory();
    client.close();

    return {
      ok: true,
      name: 'multiturn-memory',
      historyCount: history.length,
      first: {
        status: first.status,
        text: first.text,
        result: first.result
      },
      second: {
        status: second.status,
        text: second.text,
        result: second.result
      }
    };
  } catch (error) {
    client.close();
    return {
      ok: false,
      name: 'multiturn-memory',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function main() {
  mkdirSync(outputDir, { recursive: true });

  const scenarios = [];

  scenarios.push(await runScenario(
    'simple-streaming',
    'Reply with exactly OK and nothing else.',
    async () => {}
  ));

  scenarios.push(await runScenario(
    'question-and-tool',
    'Use AskUserQuestion before doing anything else. Ask exactly one question with header Choice and question Choose alpha or beta with options alpha and beta. After I answer, use Bash to run pwd. Then respond with one short sentence that says which option I picked and whether Bash succeeded.',
    async (client, request) => {
      if (request.kind === 'question') {
        await client.answerQuestion(request.id, ['beta']);
        return;
      }

      if (request.kind === 'tool_approval') {
        await client.approveRequest(request.id, { message: 'Approved by multipass validation.' });
        return;
      }

      if (request.kind === 'hook') {
        await client.approveRequest(request.id, { message: 'Approved by multipass validation.' });
      }
    }
  ));

  scenarios.push(await runMemoryScenario());

  const summary = {
    ok: scenarios.every((scenario) => scenario.ok),
    generatedAt: new Date().toISOString(),
    scenarios
  };

  writeFileSync(outputFile, JSON.stringify(summary, null, 2));

  console.log(`Wrote multipass validation result to ${outputFile}`);
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputFile, JSON.stringify({
    ok: false,
    generatedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error)
  }, null, 2));
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});