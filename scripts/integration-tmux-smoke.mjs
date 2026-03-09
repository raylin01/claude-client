#!/usr/bin/env node
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ClaudeClient } from '../dist/esm/index.js';

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();
}

function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'claude-client-tmux-'));
  run('git', ['init', '-q'], repo);
  run('git', ['config', 'user.email', 'integration@example.com'], repo);
  run('git', ['config', 'user.name', 'integration'], repo);
  writeFileSync(join(repo, 'README.md'), '# integration\n');
  run('git', ['add', 'README.md'], repo);
  run('git', ['commit', '-q', '-m', 'init'], repo);
  return repo;
}

function waitForResult(client, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.kill();
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    client.on('result', (result) => {
      clearTimeout(timeout);
      resolve(result);
    });
    client.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function main() {
  console.log('Running tmux integration smoke test...');
  const repo = makeRepo();
  const logs = [];

  const client = new ClaudeClient({
    cwd: repo,
    printMode: true,
    printModeAutoSession: false,
    worktree: 'tmux-integration',
    tmux: 'classic',
    permissionMode: 'bypassPermissions',
    dangerouslySkipPermissions: true,
    permissionPromptTool: false,
    debug: true,
    debugLogger: (message) => logs.push(message)
  });

  await client.start();
  const resultPromise = waitForResult(client, 20000);
  await client.sendMessage('Reply with exactly OK');
  const result = await resultPromise;
  client.kill();

  const spawnLog = logs.find((line) => line.includes('Print mode spawning:')) || '';
  if (!spawnLog.includes('--worktree tmux-integration')) {
    throw new Error(`cli invocation missing named --worktree: ${spawnLog}`);
  }
  if (!spawnLog.includes('--tmux=classic')) {
    throw new Error(`cli invocation missing --tmux=classic: ${spawnLog}`);
  }
  if (result?.is_error) {
    throw new Error('Claude returned an error result');
  }

  console.log('tmux integration smoke test passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
