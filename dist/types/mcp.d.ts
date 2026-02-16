import type { ClaudeClient } from './client.js';
export type McpHandler = (message: any) => Promise<any> | any;
export interface McpHandlers {
    [serverName: string]: McpHandler;
}
/**
 * Attach MCP handlers to a ClaudeClient instance.
 * Returns a cleanup function to remove the listener.
 */
export declare function attachMcpHandlers(client: ClaudeClient, handlers: McpHandlers): () => void;
