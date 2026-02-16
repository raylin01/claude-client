function defaultJsonRpcResult(message) {
    return {
        jsonrpc: '2.0',
        result: {},
        id: message && typeof message.id !== 'undefined' ? message.id : 0
    };
}
function jsonRpcError(message, error) {
    return {
        jsonrpc: '2.0',
        error: {
            code: -32000,
            message: error.message || String(error)
        },
        id: message && typeof message.id !== 'undefined' ? message.id : 0
    };
}
/**
 * Attach MCP handlers to a ClaudeClient instance.
 * Returns a cleanup function to remove the listener.
 */
export function attachMcpHandlers(client, handlers) {
    const listener = async (evt) => {
        const handler = handlers[evt.serverName];
        if (!handler) {
            await evt.respond(defaultJsonRpcResult(evt.message));
            return;
        }
        try {
            const result = await handler(evt.message);
            // If handler already returned a full JSON-RPC response, pass through
            if (result && typeof result === 'object' && result.jsonrpc) {
                await evt.respond(result);
            }
            else {
                await evt.respond({
                    jsonrpc: '2.0',
                    result: result ?? {},
                    id: evt.message && typeof evt.message.id !== 'undefined' ? evt.message.id : 0
                });
            }
        }
        catch (error) {
            await evt.respond(jsonRpcError(evt.message, error));
        }
    };
    client.on('mcp_message', listener);
    return () => {
        client.off('mcp_message', listener);
    };
}
