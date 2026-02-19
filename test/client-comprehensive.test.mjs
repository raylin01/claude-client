import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import { Writable, PassThrough } from 'stream';

import { ClaudeClient } from '../dist/esm/index.js';

// ============================================================================
// Mock Helpers
// ============================================================================

/**
 * Creates a mock ChildProcess-like object for testing
 */
function createMockProcess() {
  const mockProcess = new EventEmitter();

  // Create mock streams
  const stdin = new Writable({
    write(chunk, encoding, callback) {
      mockProcess._stdinWrites.push(chunk.toString());
      callback();
    }
  });
  stdin.write = function(chunk) {
    mockProcess._stdinWrites.push(chunk.toString());
    return true;
  };

  const stdout = new PassThrough();
  const stderr = new PassThrough();

  mockProcess.stdin = stdin;
  mockProcess.stdout = stdout;
  mockProcess.stderr = stderr;
  mockProcess._stdinWrites = [];
  mockProcess.kill = () => {
    mockProcess.killed = true;
    mockProcess.emit('exit', 0);
  };
  mockProcess.killed = false;

  return mockProcess;
}

/**
 * Creates a test client with spawn mocked
 */
function createTestClient(config = {}) {
  const client = new ClaudeClient({
    cwd: process.cwd(),
    debug: false,
    ...config
  });

  return client;
}

// ============================================================================
// Configuration Tests
// ============================================================================

test('ClaudeClient stores config correctly', () => {
  const config = {
    cwd: '/test/path',
    debug: true,
    model: 'claude-sonnet',
    maxTurns: 5,
    permissionMode: 'acceptEdits'
  };

  const client = new ClaudeClient(config);

  assert.equal(client.config.cwd, '/test/path');
  assert.equal(client.config.debug, true);
  assert.equal(client.config.model, 'claude-sonnet');
  assert.equal(client.config.maxTurns, 5);
  assert.equal(client.config.permissionMode, 'acceptEdits');
});

test('ClaudeClient uses default values for optional config', () => {
  const client = new ClaudeClient({ cwd: process.cwd() });

  assert.equal(client.config.debug, undefined);
  assert.equal(client.config.model, undefined);
  assert.equal(client.config.includePartialMessages, undefined);
});

test('ClaudeClient accepts sessionId in config', () => {
  const client = new ClaudeClient({
    cwd: process.cwd(),
    sessionId: 'test-session-123'
  });

  assert.equal(client.sessionId, 'test-session-123');
});

// ============================================================================
// Status Tracking Tests
// ============================================================================

test('getStatus returns initial idle status', () => {
  const client = createTestClient();
  assert.equal(client.getStatus(), 'idle');
});

test('getPendingAction returns null initially', () => {
  const client = createTestClient();
  assert.equal(client.getPendingAction(), null);
});

test('isProcessing returns false initially', () => {
  const client = createTestClient();
  assert.equal(client.isProcessing(), false);
});

test('status_change event fires on status update', async () => {
  const client = createTestClient();
  const statusChanges = [];

  client.on('status_change', (status, pendingAction) => {
    statusChanges.push({ status, pendingAction });
  });

  // Simulate status change via internal method
  client.handleMessage({
    type: 'control_request',
    request_id: 'req-123',
    request: {
      subtype: 'can_use_tool',
      tool_name: 'Bash',
      input: { command: 'ls' }
    }
  });

  assert.equal(statusChanges.length, 1);
  assert.equal(statusChanges[0].status, 'input_needed');
  assert.equal(statusChanges[0].pendingAction.type, 'permission');
  assert.equal(statusChanges[0].pendingAction.toolName, 'Bash');
});

// ============================================================================
// Session ID Tests
// ============================================================================

test('sessionId is extracted from system/init message', () => {
  const client = createTestClient();

  client.handleMessage({
    type: 'system',
    subtype: 'init',
    session_id: 'session-abc-123',
    model: 'claude-sonnet'
  });

  assert.equal(client.sessionId, 'session-abc-123');
});

test('sessionId is extracted from first message with session_id', () => {
  const client = createTestClient();

  client.handleMessage({
    type: 'assistant',
    session_id: 'session-from-assistant',
    message: { content: [] }
  });

  assert.equal(client.sessionId, 'session-from-assistant');
});

// ============================================================================
// Stream Event Tests
// ============================================================================

test('text_delta events are emitted for content', () => {
  const client = createTestClient();
  const deltas = [];

  client.on('text_delta', (text) => deltas.push(text));

  client.handleStreamEvent({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: 'Hello' }
  });

  client.handleStreamEvent({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: ' world' }
  });

  assert.deepEqual(deltas, ['Hello', ' world']);
});

test('thinking_delta events are emitted', () => {
  const client = createTestClient();
  const thinking = [];

  client.on('thinking_delta', (text) => thinking.push(text));

  client.handleStreamEvent({
    type: 'content_block_delta',
    delta: { type: 'thinking_delta', thinking: 'Let me think...' }
  });

  assert.deepEqual(thinking, ['Let me think...']);
});

test('text_accumulated contains running total', () => {
  const client = createTestClient();
  const accumulated = [];

  client.on('text_accumulated', (text) => accumulated.push(text));

  client.handleStreamEvent({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: 'One' }
  });

  client.handleStreamEvent({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: ' Two' }
  });

  client.handleStreamEvent({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: ' Three' }
  });

  assert.deepEqual(accumulated, ['One', 'One Two', 'One Two Three']);
});

test('message_start resets accumulators', () => {
  const client = createTestClient();
  const accumulated = [];

  client.on('text_accumulated', (text) => accumulated.push(text));

  // First message
  client.handleStreamEvent({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: 'First' }
  });

  // New message starts
  client.handleStreamEvent({
    type: 'message_start',
    message: {}
  });

  // Second message content
  client.handleStreamEvent({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: 'Second' }
  });

  assert.deepEqual(accumulated, ['First', 'Second']);
});

// ============================================================================
// Tool Use Tests
// ============================================================================

test('tool_use_start is emitted when tool block completes', () => {
  const client = createTestClient();
  const toolUses = [];

  client.on('tool_use_start', (tool) => toolUses.push(tool));

  // Start tool block
  client.handleStreamEvent({
    type: 'content_block_start',
    content_block: {
      type: 'tool_use',
      id: 'tool-123',
      name: 'Bash'
    }
  });

  // Accumulate JSON input
  client.handleStreamEvent({
    type: 'content_block_delta',
    delta: { type: 'input_json_delta', partial_json: '{"command": "ls"' }
  });

  client.handleStreamEvent({
    type: 'content_block_delta',
    delta: { type: 'input_json_delta', partial_json: ', "description": "list"}' }
  });

  // Complete tool block
  client.handleStreamEvent({
    type: 'content_block_stop',
    index: 0
  });

  assert.equal(toolUses.length, 1);
  assert.equal(toolUses[0].id, 'tool-123');
  assert.equal(toolUses[0].name, 'Bash');
  assert.deepEqual(toolUses[0].input, { command: 'ls', description: 'list' });
});

test('tool_result is emitted from user message', () => {
  const client = createTestClient();
  const results = [];

  client.on('tool_result', (result) => results.push(result));

  client.handleMessage({
    type: 'user',
    message: {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tool-123', content: 'output', is_error: false }
      ]
    }
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].toolUseId, 'tool-123');
  assert.equal(results[0].content, 'output');
  assert.equal(results[0].isError, false);
});

// ============================================================================
// Control Request/Response Tests
// ============================================================================

test('control_request is emitted for permission prompts', () => {
  const client = createTestClient();
  const requests = [];

  client.on('control_request', (req) => requests.push(req));

  client.handleMessage({
    type: 'control_request',
    request_id: 'req-123',
    request: {
      subtype: 'can_use_tool',
      tool_name: 'Bash',
      input: { command: 'rm -rf /' }
    }
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].request_id, 'req-123');
  assert.equal(requests[0].request.tool_name, 'Bash');
});

test('pendingAction is set for AskUserQuestion', () => {
  const client = createTestClient();

  client.handleMessage({
    type: 'control_request',
    request_id: 'req-456',
    request: {
      subtype: 'can_use_tool',
      tool_name: 'AskUserQuestion',
      input: {
        question: 'What do you prefer?',
        options: ['A', 'B']
      }
    }
  });

  const action = client.getPendingAction();
  assert.equal(action.type, 'question');
  assert.equal(action.question, 'What do you prefer?');
  assert.deepEqual(action.options, ['A', 'B']);
});

test('control_cancel_request clears pending action', () => {
  const client = createTestClient();

  // Set up a pending action
  client.handleMessage({
    type: 'control_request',
    request_id: 'req-789',
    request: {
      subtype: 'can_use_tool',
      tool_name: 'Bash',
      input: { command: 'ls' }
    }
  });

  assert.notEqual(client.getPendingAction(), null);

  // Cancel it
  client.handleMessage({
    type: 'control_cancel_request',
    request_id: 'req-789'
  });

  assert.equal(client.getPendingAction(), null);
});

// ============================================================================
// Result Message Tests
// ============================================================================

test('result message updates status to idle', () => {
  const client = createTestClient();

  // First set status to something other than idle so change is detected
  client._status = 'running';

  const statusChanges = [];
  client.on('status_change', (status) => statusChanges.push(status));

  client.handleMessage({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: 'test-session'
  });

  assert.equal(client.getStatus(), 'idle');
  assert.ok(statusChanges.includes('idle'));
});

test('result message with error sets error status', () => {
  const client = createTestClient();

  client.handleMessage({
    type: 'result',
    subtype: 'error',
    is_error: true,
    session_id: 'test-session'
  });

  assert.equal(client.getStatus(), 'error');
});

test('result message emits result event', () => {
  const client = createTestClient();
  const results = [];

  client.on('result', (result) => results.push(result));

  client.handleMessage({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: 'test-session',
    duration_ms: 1000,
    result: 'Done!'
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].result, 'Done!');
  assert.equal(results[0].duration_ms, 1000);
});

// ============================================================================
// Message Queue Tests
// ============================================================================

test('queueMessage queues when processing', () => {
  const client = createTestClient();

  // Simulate processing state
  client._isProcessingMessage = true;

  const sentMessages = [];
  client.sendMessage = async (msg) => sentMessages.push(msg);

  client.queueMessage('first');
  client.queueMessage('second');

  // Should not have sent immediately
  assert.equal(sentMessages.length, 0);
});

test('queueMessage sends immediately when not processing', () => {
  const client = createTestClient();

  const sentMessages = [];
  client.sendMessage = async (msg) => sentMessages.push(msg);

  client.queueMessage('hello');

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0], 'hello');
});

// ============================================================================
// Usage Update Tests
// ============================================================================

test('usage_update is emitted from message_delta', () => {
  const client = createTestClient();
  const usageUpdates = [];

  client.on('usage_update', (usage) => usageUpdates.push(usage));

  client.handleStreamEvent({
    type: 'message_delta',
    usage: {
      input_tokens: 100,
      output_tokens: 50
    }
  });

  assert.equal(usageUpdates.length, 1);
  assert.equal(usageUpdates[0].input_tokens, 100);
  assert.equal(usageUpdates[0].output_tokens, 50);
});

// ============================================================================
// MCP Message Tests
// ============================================================================

test('mcp_message event is emitted for MCP requests', async () => {
  const client = createTestClient();
  const mcpMessages = [];

  // Mock sendMcpControlResponse to avoid "Process not running" error
  client.sendMcpControlResponse = async () => {};

  client.on('mcp_message', (event) => {
    mcpMessages.push(event);
    // Call respond to test the interface (mocked)
    event.respond({ jsonrpc: '2.0', result: {}, id: 1 });
  });

  // This would normally trigger an MCP response
  client.handleMessage({
    type: 'control_request',
    request_id: 'mcp-req-123',
    request: {
      subtype: 'mcp_message',
      server_name: 'test-server',
      message: { id: 1, method: 'tools/list' }
    }
  });

  // Wait for async handling
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.equal(mcpMessages.length, 1);
  assert.equal(mcpMessages[0].serverName, 'test-server');
  assert.equal(mcpMessages[0].message.method, 'tools/list');
});

// ============================================================================
// Hook Callback Tests
// ============================================================================

test('hook_callback event is emitted', async () => {
  const client = createTestClient();
  const callbacks = [];

  client.on('hook_callback', (event) => callbacks.push(event));

  client.handleMessage({
    type: 'control_request',
    request_id: 'hook-123',
    request: {
      subtype: 'hook_callback',
      callback_id: 'cb-456',
      tool_use_id: 'tool-789',
      input: { test: true }
    }
  });

  assert.equal(callbacks.length, 1);
  assert.equal(callbacks[0].callbackId, 'cb-456');
  assert.equal(callbacks[0].toolUseId, 'tool-789');
});

// ============================================================================
// Error Handling Tests
// ============================================================================

test('error event is emitted for process errors', () => {
  const client = createTestClient();
  const errors = [];

  client.on('error', (err) => errors.push(err));

  // Simulate internal error handling would emit this
  client.emit('error', new Error('Test error'));

  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'Test error');
});

// ============================================================================
// Ready Event Tests
// ============================================================================

test('ready event is emitted on system init', () => {
  const client = createTestClient();
  let readyFired = false;

  client.on('ready', () => readyFired = true);

  client.handleMessage({
    type: 'system',
    subtype: 'init',
    session_id: 'session-ready-test',
    model: 'claude-sonnet'
  });

  assert.equal(readyFired, true);
});

// ============================================================================
// Print Mode Tests
// ============================================================================

test('print mode client does not spawn process on start()', async () => {
  const client = new ClaudeClient({
    cwd: process.cwd(),
    printMode: true
  });

  let readyFired = false;
  client.on('ready', () => readyFired = true);

  await client.start();

  // Should emit ready immediately without spawning process
  assert.equal(readyFired, true);
  assert.equal(client.process, null);
});

test('print mode auto-generates session ID if not provided', () => {
  const client = new ClaudeClient({
    cwd: process.cwd(),
    printMode: true
  });

  // Should have auto-generated a session ID
  assert.ok(client.sessionId);
  assert.ok(client.sessionId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/));
});

test('print mode uses provided session ID', () => {
  const client = new ClaudeClient({
    cwd: process.cwd(),
    printMode: true,
    sessionId: 'my-custom-session-id'
  });

  assert.equal(client.sessionId, 'my-custom-session-id');
});

test('print mode can disable auto session ID generation', () => {
  const client = new ClaudeClient({
    cwd: process.cwd(),
    printMode: true,
    printModeAutoSession: false
  });

  assert.equal(client.sessionId, null);
});

test('buildPrintModeArgs includes -p flag', () => {
  const client = new ClaudeClient({
    cwd: process.cwd(),
    printMode: true
  });

  const args = client.buildPrintModeArgs(true, 'hello');

  assert.ok(args.includes('-p'));
  assert.ok(args.includes('--output-format'));
  assert.ok(args.includes('stream-json'));
  assert.ok(args.includes('--verbose'));
});

test('buildPrintModeArgs uses --session-id for first message', () => {
  const client = new ClaudeClient({
    cwd: process.cwd(),
    printMode: true,
    sessionId: 'test-session-123'
  });

  const args = client.buildPrintModeArgs(true, 'hello');

  const sessionIdIndex = args.indexOf('--session-id');
  assert.ok(sessionIdIndex !== -1);
  assert.equal(args[sessionIdIndex + 1], 'test-session-123');

  // Should NOT have --resume
  assert.ok(!args.includes('--resume'));
});

test('buildPrintModeArgs uses --resume for subsequent messages', () => {
  const client = new ClaudeClient({
    cwd: process.cwd(),
    printMode: true,
    sessionId: 'test-session-123'
  });

  const args = client.buildPrintModeArgs(false, 'hello');

  const resumeIndex = args.indexOf('--resume');
  assert.ok(resumeIndex !== -1);
  assert.equal(args[resumeIndex + 1], 'test-session-123');

  // Should NOT have --session-id
  assert.ok(!args.includes('--session-id'));
});

test('buildPrintModeArgs includes permission-prompt-tool stdio by default', () => {
  const client = new ClaudeClient({
    cwd: process.cwd(),
    printMode: true
  });

  const args = client.buildPrintModeArgs(true, 'hello');

  const permIndex = args.indexOf('--permission-prompt-tool');
  assert.ok(permIndex !== -1);
  assert.equal(args[permIndex + 1], 'stdio');

  // Should also include input-format for control responses
  assert.ok(args.includes('--input-format'));
});

test('buildPrintModeArgs respects permissionPromptTool=false', () => {
  const client = new ClaudeClient({
    cwd: process.cwd(),
    printMode: true,
    permissionPromptTool: false
  });

  const args = client.buildPrintModeArgs(true, 'hello');

  assert.ok(!args.includes('--permission-prompt-tool'));
  assert.ok(!args.includes('--input-format'));
});

test('buildPrintModeArgs includes model when specified', () => {
  const client = new ClaudeClient({
    cwd: process.cwd(),
    printMode: true,
    model: 'claude-sonnet'
  });

  const args = client.buildPrintModeArgs(true, 'hello');

  const modelIndex = args.indexOf('--model');
  assert.ok(modelIndex !== -1);
  assert.equal(args[modelIndex + 1], 'claude-sonnet');
});

test('buildPrintModeArgs includes MCP servers config', () => {
  const client = new ClaudeClient({
    cwd: process.cwd(),
    printMode: true,
    mcpServers: {
      'test-server': { command: 'node', args: ['server.js'] }
    }
  });

  const args = client.buildPrintModeArgs(true, 'hello');

  const mcpIndex = args.indexOf('--mcp-config');
  assert.ok(mcpIndex !== -1);
  assert.ok(args[mcpIndex + 1].includes('test-server'));
});

test('buildPrintModeArgs puts prompt text as last argument', () => {
  const client = new ClaudeClient({
    cwd: process.cwd(),
    printMode: true
  });

  const promptText = 'What is 2+2?';
  const args = client.buildPrintModeArgs(true, promptText);

  assert.equal(args[args.length - 1], promptText);
});

test('print mode tracks first message state', async () => {
  const client = new ClaudeClient({
    cwd: process.cwd(),
    printMode: true
  });

  await client.start();

  // First message should be flagged as first
  assert.equal(client._printModeFirstMessage, true);

  // After simulating one message cycle, it should be false
  // (We can't easily test actual sendMessage without spawning real process)
});

