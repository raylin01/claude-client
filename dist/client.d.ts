import { EventEmitter } from 'events';
import { Usage, AssistantMessage, UserMessage, ControlRequestMessage, ResultMessage, StreamEventMessage, ControlResponseData } from './types.js';
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
export interface ToolUseStartEvent {
    id: string;
    name: string;
    input: Record<string, any>;
}
export interface ToolResultEvent {
    toolUseId: string;
    content: string;
    isError: boolean;
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
    on(event: 'tool_use_start', listener: (tool: ToolUseStartEvent) => void): this;
    on(event: 'tool_result', listener: (result: ToolResultEvent) => void): this;
    on(event: 'control_request', listener: (request: ControlRequestMessage) => void): this;
    on(event: 'user_message', listener: (message: UserMessage) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'exit', listener: (code: number | null) => void): this;
    on(event: 'result', listener: (result: ResultMessage) => void): this;
    on(event: 'usage_update', listener: (usage: Usage) => void): this;
    on(event: 'status_change', listener: (status: SessionStatus, pendingAction: PendingAction | null) => void): this;
}
/**
 * Session status
 */
export type SessionStatus = 'running' | 'input_needed' | 'idle' | 'error';
/**
 * Pending action requiring user input
 */
export interface PendingAction {
    type: 'permission' | 'question';
    requestId: string;
    toolName?: string;
    input?: Record<string, any>;
    question?: string;
    options?: string[];
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
    private _currentToolBlock;
    private _status;
    private _pendingAction;
    private _messageQueue;
    private _isProcessingMessage;
    constructor(config: ClaudeClientConfig);
    get sessionId(): string | null;
    /**
     * Get current session status
     */
    getStatus(): SessionStatus;
    /**
     * Get pending action (if status is 'input_needed')
     */
    getPendingAction(): PendingAction | null;
    /**
     * Check if currently processing a message
     */
    isProcessing(): boolean;
    /**
     * Queue a message to be sent when Claude is ready
     * If not processing, sends immediately
     */
    queueMessage(text: string): void;
    /**
     * Process next message in queue (called after result received)
     */
    private processNextQueuedMessage;
    /**
     * Update status and emit event
     */
    private setStatus;
    /**
     * Start the Claude CLI process
     */
    start(): Promise<void>;
    sendMessage(text: string): Promise<void>;
    /**
     * Send a control response (permission decision, answer, etc.)
     */
    sendControlResponse(requestId: string, responseData: ControlResponseData): Promise<void>;
    /**
     * Interrupt current operation (like Ctrl+C but via protocol)
     */
    interrupt(): Promise<void>;
    /**
     * Terminate the session
     */
    kill(): void;
    /**
     * Send a message with multiple content blocks (text, images, etc.)
     */
    sendMessageWithContent(content: Array<{
        type: string;
        [key: string]: any;
    }>): Promise<void>;
    private writeToStdin;
    private processLine;
    private handleMessage;
    private handleStreamEvent;
    /**
     * Get max thinking tokens based on thinking level setting
     */
    private getMaxThinkingTokens;
    /**
     * Parse tool results from user messages and emit events
     */
    private handleToolResults;
}
