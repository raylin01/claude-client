import { ClaudeClient } from '@raylin01/claude-client';

const client = new ClaudeClient({ cwd: process.cwd() });

client.on('ready', () => {
  void client.sendMessage('Hello Claude. Give me a short intro.');
});

client.on('text_delta', (delta) => process.stdout.write(delta));
client.on('result', () => process.stdout.write('\n'));

await client.start();
