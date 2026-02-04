import { EventEmitter } from 'events';
import { StreamEventMessage, AssistantMessage, UserMessage, ControlRequestMessage, ControlResponseData } from './types.js';
export interface ClaudeClientConfig {
    /**
     * Working directory for the Claude CLI
     */
    cwd: string;
    /**
     * Optional custom path to claude binary
     */
    claudePath?: string;
    /**
     * Environment variables to pass to the CLI
     */
    env?: NodeJS.ProcessEnv;
    /**
     * Enable debug logging
     */
    debug?: boolean;
    /**
     * Command line arguments to pass to the CLI
     */
    args?: string[];
    /**
     * Optional session ID to use before system/init arrives
     */
    sessionId?: string;
    /**
     * Thinking configuration
     */
    thinking?: {
        maxTokens?: number;
        level?: 'off' | 'low' | 'medium' | 'high' | 'auto' | 'default_on';
    };
}
export declare interface ClaudeClient {
    on(event: 'ready', listener: () => void): this;
    on(event: 'message', listener: (message: AssistantMessage) => void): this;
    on(event: 'stream_event', listener: (event: StreamEventMessage) => void): this;
    on(event: 'text_delta', listener: (text: string) => void): this;
    on(event: 'thinking_delta', listener: (thinking: string) => void): this;
    on(event: 'text_accumulated', listener: (text: string) => void): this;
    on(event: 'thinking_accumulated', listener: (thinking: string) => void): this;
    on(event: 'tool_use', listener: (tool: any) => void): this;
    on(event: 'control_request', listener: (request: ControlRequestMessage) => void): this;
    on(event: 'user_message', listener: (message: UserMessage) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'exit', listener: (code: number | null) => void): this;
}
export declare class ClaudeClient extends EventEmitter {
    private process;
    private stdinReady;
    private config;
    private buffer;
    private readyEmitted;
    private _sessionId;
    private _isThinking;
    private _accumulatedText;
    private _accumulatedThinking;
    constructor(config: ClaudeClientConfig);
    get sessionId(): string | null;
    /**
     * Start the Claude CLI process
     */
    start(): Promise<void>;
    /**
     * Send a user message to Claude
     */
    sendMessage(text: string): Promise<void>;
    /**
     * Send a control response (permission decision, answer, etc.)
     */
    sendControlResponse(requestId: string, responseData: ControlResponseData): Promise<void>;
    /**
     * Terminate the session
     */
    kill(): void;
    private writeToStdin;
    private processLine;
    private handleMessage;
    private handleStreamEvent;
    /**
     * Get max thinking tokens based on thinking level setting
     */
    private getMaxThinkingTokens;
}
