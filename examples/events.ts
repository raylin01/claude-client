import { ClaudeClient } from '@raylin01/claude-client';

const client = new ClaudeClient({ cwd: process.cwd(), debug: true });

client.on('ready', () => console.log('ready'));
client.on('control_request', (request) => {
  console.log('control_request', request.request.subtype);
});
client.on('tool_use_start', (tool) => {
  console.log('tool_use_start', tool.name, tool.id);
});
client.on('tool_result', (result) => {
  console.log('tool_result', result.toolUseId, result.isError);
});

await client.start();
await client.sendMessage('List the files in this directory.');
