import { ClaudeClient } from '@raylin01/claude-client';

const client = await ClaudeClient.init({
  cwd: process.cwd(),
  includePartialMessages: true
});

const turn = client.send('Hello Claude. Give me a short intro.');

for await (const update of turn.updates()) {
  if (update.kind === 'output' && update.snapshot.currentOutputKind === 'text') {
    process.stdout.write(`\r${update.snapshot.text}`);
  }
}

const finalSnapshot = await turn.done;
process.stdout.write(`\n\nFinal result: ${finalSnapshot.result?.subtype || 'unknown'}\n`);
client.close();
