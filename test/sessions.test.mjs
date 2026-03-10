import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  escapeProjectPath,
  listClaudeSessionSummaries,
  readClaudeSessionRecord
} from '../dist/esm/index.js';

test('session browser lists and reads Claude sessions from disk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'claude-client-test-'));
  const projectRoot = join(root, 'project');
  const storageDir = join(root, '.claude', 'projects', escapeProjectPath(projectRoot));
  await mkdir(storageDir, { recursive: true });

  const sessionId = 'claude-session-1';
  await writeFile(join(storageDir, 'sessions-index.json'), JSON.stringify({
    version: 1,
    entries: [
      {
        sessionId,
        fullPath: join(storageDir, `${sessionId}.jsonl`),
        fileMtime: Date.parse('2026-01-01T00:00:02.000Z'),
        firstPrompt: 'Inspect the repo',
        messageCount: 2,
        created: '2026-01-01T00:00:00.000Z',
        modified: '2026-01-01T00:00:02.000Z',
        gitBranch: 'main',
        projectPath: projectRoot,
        isSidechain: false
      }
    ]
  }), 'utf8');

  await writeFile(join(storageDir, `${sessionId}.jsonl`), [
    JSON.stringify({ type: 'summary', summary: 'Inspect the repo', timestamp: '2026-01-01T00:00:00.000Z' }),
    JSON.stringify({
      type: 'user',
      uuid: 'user-1',
      timestamp: '2026-01-01T00:00:01.000Z',
      sessionId,
      message: { role: 'user', content: [{ type: 'text', text: 'Inspect the repo' }] }
    }),
    JSON.stringify({
      type: 'assistant',
      uuid: 'assistant-1',
      timestamp: '2026-01-01T00:00:02.000Z',
      sessionId,
      message: { role: 'assistant', content: [{ type: 'text', text: 'Repository inspected.' }] }
    })
  ].join('\n'), 'utf8');

  const summaries = await listClaudeSessionSummaries(projectRoot, { homeDir: root });
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].provider, 'claude');
  assert.equal(summaries[0].title, 'Inspect the repo');

  const record = await readClaudeSessionRecord(sessionId, projectRoot, { homeDir: root });
  assert.equal(record?.provider, 'claude');
  assert.equal(record?.rawMessages.length, 3);
  assert.equal(record?.messages.some((message) => message.role === 'assistant'), true);
  assert.equal(record?.messages.some((message) => message.content[0].type === 'text'), true);
});