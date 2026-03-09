#!/usr/bin/env node
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ClaudeClient } from '../dist/esm/index.js';

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();
}

function makeRepo(prefix) {
  const repo = mkdtempSync(join(tmpdir(), prefix));
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
    const timeout = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
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

async function runCase(label, worktree) {
  const repo = makeRepo(`claude-client-worktree-${label}-`);
  const logs = [];

  const client = new ClaudeClient({
    cwd: repo,
    worktree,
    permissionMode: 'bypassPermissions',
    dangerouslySkipPermissions: true,
    permissionPromptTool: false,
    debug: true,
    debugLogger: (message) => logs.push(message)
  });

  await client.start();
  const resultPromise = waitForResult(client);
  await client.sendMessage('Reply with exactly OK');
  const result = await resultPromise;
  client.kill();

  const spawnLog = logs.find((line) => line.includes('Spawning:')) || '';
  if (!spawnLog.includes('--worktree')) {
    throw new Error(`[${label}] cli invocation missing --worktree in spawn log: ${spawnLog}`);
  }
  if (typeof worktree === 'string' && !spawnLog.includes(`--worktree ${worktree}`)) {
    throw new Error(`[${label}] cli invocation missing named worktree: ${spawnLog}`);
  }
  if (result?.is_error) {
    throw new Error(`[${label}] Claude returned an error result`);
  }

  const worktreeList = run('git', ['worktree', 'list', '--porcelain'], repo);
  const worktreeCount = worktreeList
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .length;

  if (worktreeCount < 2) {
    throw new Error(
      `[${label}] --worktree flag reached Claude but no extra worktree was created.\n` +
      `Repository: ${repo}\n` +
      `git worktree list --porcelain:\n${worktreeList}`
    );
  }

  console.log(`[${label}] PASS: ${worktreeCount} worktrees detected`);
}

async function main() {
  console.log('Running worktree integration smoke tests...');
  await runCase('boolean', true);
  await runCase('named', 'feature-integration');
  console.log('All worktree integration smoke tests passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
