import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ClaudeClient,
  TaskMessageQueue,
  TaskStore,
  attachMcpHandlers,
  escapeProjectPath,
  unescapeProjectPath
} from '../dist/esm/index.js';

test('TaskMessageQueue enqueues and dequeues in order', async () => {
  const queue = new TaskMessageQueue();
  await queue.enqueue('task-1', {
    taskId: 'task-1',
    message: { type: 'a' },
    timestamp: new Date('2026-01-01T00:00:00.000Z')
  });
  await queue.enqueue('task-1', {
    taskId: 'task-1',
    message: { type: 'b' },
    timestamp: new Date('2026-01-01T00:00:01.000Z')
  });

  const first = await queue.dequeue('task-1');
  const second = await queue.dequeue('task-1');
  const third = await queue.dequeue('task-1');

  assert.equal(first?.message.type, 'a');
  assert.equal(second?.message.type, 'b');
  assert.equal(third, undefined);
});

test('TaskStore updates lifecycle state', () => {
  const store = new TaskStore();
  store.createTask('task-1', { input: { prompt: 'hello' } });
  store.setStatus('task-1', 'running');
  store.completeTask('task-1', { ok: true });

  const task = store.getTask('task-1');
  assert.ok(task);
  assert.equal(task.status, 'completed');
  assert.deepEqual(task.output, { ok: true });
});

test('attachMcpHandlers routes responses and returns cleanup function', async () => {
  const client = new ClaudeClient({ cwd: process.cwd() });

  const captured = [];
  const dispose = attachMcpHandlers(client, {
    weather: (message) => ({ temp: message.params.city === 'SF' ? 61 : 0 })
  });

  const event = {
    serverName: 'weather',
    message: { id: 1, params: { city: 'SF' } },
    respond: async (response) => {
      captured.push(response);
    }
  };

  client.emit('mcp_message', event);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(captured.length, 1);
  assert.equal(captured[0].jsonrpc, '2.0');
  assert.deepEqual(captured[0].result, { temp: 61 });

  dispose();
});

test('ClaudeClient accumulates stream deltas', () => {
  const client = new ClaudeClient({ cwd: process.cwd() });
  const deltas = [];
  const accumulated = [];

  client.on('text_delta', (delta) => deltas.push(delta));
  client.on('text_accumulated', (value) => accumulated.push(value));

  client.handleStreamEvent({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: 'Hello' }
  });

  client.handleStreamEvent({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: ' world' }
  });

  assert.deepEqual(deltas, ['Hello', ' world']);
  assert.deepEqual(accumulated, ['Hello', 'Hello world']);
});

test('session path escaping stays deterministic', () => {
  const escaped = escapeProjectPath('/Users/ray/Documents/DisCode');
  assert.equal(escaped, '-Users-ray-Documents-DisCode');
  assert.equal(unescapeProjectPath(escaped), '/Users/ray/Documents/DisCode');
});
