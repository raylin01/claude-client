import { ClaudeClient } from '@raylin01/claude-client';

const client = await ClaudeClient.init({
  cwd: process.cwd(),
  includePartialMessages: true,
  permissionPromptTool: true,
  permissionMode: 'default'
});

async function handleOpenRequests(snapshot) {
  for (const request of snapshot.openRequests) {
    if (request.status !== 'open') {
      continue;
    }

    if (request.kind === 'question') {
      console.log(`\nQuestion: ${request.prompt}`);
      await client.answerQuestion(request.id, ['beta']);
      continue;
    }

    if (request.kind === 'tool_approval') {
      console.log(`\nApproving tool: ${request.toolName}`);
      await client.approveRequest(request.id, {
        message: 'Approved by structured example.'
      });
      continue;
    }

    if (request.kind === 'hook') {
      await client.approveRequest(request.id, {
        message: 'Approved by structured example.'
      });
    }
  }
}

const turn = client.send(
  'Use AskUserQuestion to ask me to choose alpha or beta. After I answer, use Bash to run pwd. Then summarize the choice and whether Bash succeeded.'
);

for await (const update of turn.updates()) {
  const snapshot = update.snapshot;

  if (update.kind === 'output' && snapshot.currentOutputKind === 'text') {
    process.stdout.write(`\r${snapshot.text}`);
  }

  await handleOpenRequests(snapshot);
}

const finalSnapshot = await turn.done;
console.log('\n\nTurn complete:');
console.log(JSON.stringify({
  status: finalSnapshot.status,
  text: finalSnapshot.text,
  toolUses: finalSnapshot.toolUses.map((tool) => tool.name),
  toolResults: finalSnapshot.toolResults.map((result) => ({
    toolUseId: result.toolUseId,
    isError: result.isError
  })),
  result: finalSnapshot.result
}, null, 2));

client.close();