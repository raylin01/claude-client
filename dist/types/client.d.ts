import { EventEmitter } from 'events';
import { SystemMessage, Usage, AssistantMessage, UserMessage, ControlRequestMessage, ResultMessage, StreamEventMessage, ControlResponseData, ControlCancelRequestMessage, McpMessageEvent, HookCallbackEvent, ControlResponseEnvelope, TaskMessageEvent, ClaudeSupportedModelsResponse } from './types.js';
import type { TaskStore } from './task-store.js';
import type { TaskMessageQueue } from './task-queue.js';
import type { StructuredClaudeClient } from './structured.js';
export type ClaudePermissionMode = 'acceptEdits' | 'bypassPermissions' | 'default' | 'dontAsk' | 'plan';
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
     * Executable to use when claudePath points to a script (default: node)
     */
    executable?: string;
    /**
     * Extra args for the executable when claudePath points to a script
     */
    executableArgs?: string[];
    /**
     * Environment variables to pass to the CLI
     */
    env?: NodeJS.ProcessEnv;
    /**
     * Enable debug logging
     */
    debug?: boolean;
    /**
     * Enable CLI debug mode; string value is passed as a filter.
     */
    debugMode?: boolean | string;
    /**
     * Write CLI debug logs to file (passes --debug-file)
     */
    debugFile?: string;
    /**
     * Override verbose mode (passes --verbose). Defaults to true.
     */
    verbose?: boolean;
    /**
     * Optional debug logger callback.
     */
    debugLogger?: (message: string) => void;
    /**
     * Command line arguments to pass to the CLI
     */
    args?: string[];
    /**
     * Include partial messages (passes --include-partial-messages)
     */
    includePartialMessages?: boolean;
    /**
     * Use permission prompt tool over stdio (passes --permission-prompt-tool stdio)
     */
    permissionPromptTool?: boolean;
    /**
     * Custom permission prompt tool name (passes --permission-prompt-tool <name>)
     */
    permissionPromptToolName?: string;
    /**
     * Optional session ID to use before system/init arrives
     */
    sessionId?: string;
    /**
     * Resume an existing session ID (passes --resume)
     */
    resumeSessionId?: string;
    /**
     * Continue last conversation (passes --continue)
     */
    continueConversation?: boolean;
    /**
     * Fork session on resume (passes --fork-session)
     */
    forkSession?: boolean;
    /**
     * Resume at a specific message UUID (passes --resume-session-at)
     */
    resumeSessionAt?: string;
    /**
     * Disable session persistence (passes --no-session-persistence)
     */
    persistSession?: boolean;
    /**
     * Max turns for the session (passes --max-turns)
     */
    maxTurns?: number;
    /**
     * Max budget in USD (passes --max-budget-usd)
     */
    maxBudgetUsd?: number;
    /**
     * Initial model (passes --model)
     */
    model?: string;
    /**
     * Fallback model (passes --fallback-model)
     */
    fallbackModel?: string;
    /**
     * Agent name (passes --agent)
     */
    agent?: string;
    /**
     * Experimental betas (passes --betas)
     */
    betas?: string[];
    /**
     * JSON schema for input (passes --json-schema)
     */
    jsonSchema?: Record<string, any> | string;
    /**
     * Permission mode (passes --permission-mode)
     */
    permissionMode?: ClaudePermissionMode;
    /**
     * Allow skipping permissions dangerously (passes --allow-dangerously-skip-permissions)
     */
    allowDangerouslySkipPermissions?: boolean;
    /**
     * Bypass all permission checks (passes --dangerously-skip-permissions)
     */
    dangerouslySkipPermissions?: boolean;
    /**
     * Allowed tools list (passes --allowedTools)
     */
    allowedTools?: string[];
    /**
     * Disallowed tools list (passes --disallowedTools)
     */
    disallowedTools?: string[];
    /**
     * Tools list (passes --tools)
     */
    tools?: string[] | 'default';
    /**
     * MCP server config (passes --mcp-config)
     */
    mcpServers?: Record<string, any>;
    /**
     * Enable deprecated MCP debug mode (passes --mcp-debug)
     */
    mcpDebug?: boolean;
    /**
     * Strict MCP config (passes --strict-mcp-config)
     */
    strictMcpConfig?: boolean;
    /**
     * Setting sources (passes --setting-sources)
     */
    settingSources?: string[];
    /**
     * Additional directories (passes --add-dir)
     */
    additionalDirectories?: string[];
    /**
     * File resources to download at startup (passes --file)
     */
    files?: string[];
    /**
     * Create a new git worktree for this session (passes --worktree [name])
     */
    worktree?: boolean | string;
    /**
     * Create a tmux session for worktree mode (passes --tmux / --tmux=<mode>)
     */
    tmux?: boolean | string;
    /**
     * Enable/disable Claude in Chrome integration (passes --chrome / --no-chrome)
     */
    chrome?: boolean;
    /**
     * Auto-connect to IDE when exactly one is available (passes --ide)
     */
    ide?: boolean;
    /**
     * Disable all slash commands (passes --disable-slash-commands)
     */
    disableSlashCommands?: boolean;
    /**
     * Effort level (passes --effort)
     */
    effort?: 'low' | 'medium' | 'high';
    /**
     * Resume a session linked to a PR (passes --from-pr [value])
     */
    fromPr?: boolean | string;
    /**
     * System prompt override (passes --system-prompt)
     */
    systemPrompt?: string;
    /**
     * Append system prompt (passes --append-system-prompt)
     */
    appendSystemPrompt?: string;
    /**
     * Custom agents JSON (passes --agents)
     */
    agents?: Record<string, any> | string;
    /**
     * Print mode output format (passes --output-format)
     */
    outputFormat?: 'text' | 'json' | 'stream-json';
    /**
     * Print mode input format (passes --input-format)
     */
    inputFormat?: 'text' | 'stream-json';
    /**
     * Re-emit user messages in stream-json mode (passes --replay-user-messages)
     */
    replayUserMessages?: boolean;
    /**
     * Path or JSON string for settings (passes --settings)
     */
    settings?: Record<string, any> | string;
    /**
     * Plugins to load (passes --plugin-dir)
     */
    plugins?: Array<{
        type: 'local';
        path: string;
    }>;
    /**
     * Extra CLI args as key-value flags (passes --key value / --key when null)
     */
    extraArgs?: Record<string, any>;
    /**
     * Optional sandbox setting (merged into settings for extraArgs)
     */
    sandbox?: string;
    /**
     * Enable SDK file checkpointing hooks (sets CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING)
     */
    enableFileCheckpointing?: boolean;
    /**
     * Thinking configuration
     */
    thinking?: {
        maxTokens?: number;
        level?: 'off' | 'low' | 'medium' | 'high' | 'auto' | 'default_on';
    };
    /**
     * Optional task store for MCP task tracking
     */
    taskStore?: TaskStore;
    /**
     * Optional task message queue
     */
    taskQueue?: TaskMessageQueue;
    /**
     * Enable print mode (-p flag) - runs one-shot commands instead of persistent session.
     * In print mode, each message spawns a new process but session persistence is
     * maintained via --session-id (first message) and --resume (subsequent messages).
     */
    printMode?: boolean;
    /**
     * In print mode, automatically generate a session ID if not provided.
     * This allows multi-turn conversations even with print mode.
     * Default: true when printMode is enabled
     */
    printModeAutoSession?: boolean;
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
    on(event: 'system', listener: (message: SystemMessage) => void): this;
    on(event: 'mcp_message', listener: (event: McpMessageEvent) => void): this;
    on(event: 'hook_callback', listener: (event: HookCallbackEvent) => void): this;
    on(event: 'task_message', listener: (event: TaskMessageEvent) => void): this;
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
    on(event: 'control_cancel_request', listener: (request: ControlCancelRequestMessage) => void): this;
    on(event: 'control_response', listener: (response: ControlResponseEnvelope) => void): this;
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
    private config;
    private readyEmitted;
    private _sessionId;
    private _lastSystemModel;
    private _accumulatedText;
    private _accumulatedThinking;
    private _currentToolBlock;
    private _status;
    private _pendingAction;
    private pendingControlRequests;
    private pendingControlResponses;
    private taskStore;
    private taskQueue;
    private readonly mcpResponseTimeoutMs;
    private _messageQueue;
    private _isProcessingMessage;
    private _printModeFirstMessage;
    constructor(config: ClaudeClientConfig);
    static init(config: ClaudeClientConfig): Promise<StructuredClaudeClient>;
    private logDebug;
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
     * Send a message in print mode (spawns new process)
     */
    private sendMessagePrintMode;
    /**
     * Build command line arguments for print mode
     */
    private buildPrintModeArgs;
    /**
     * Send a control response (permission decision, answer, etc.)
     */
    sendControlResponse(requestId: string, responseData: ControlResponseData): Promise<void>;
    /**
     * Interrupt current operation (like Ctrl+C but via protocol)
     */
    interrupt(): Promise<void>;
    /**
     * Set permission mode (default or acceptEdits)
     */
    setPermissionMode(mode: ClaudePermissionMode): Promise<void>;
    /**
     * Set model for the session
     */
    setModel(model: string): Promise<void>;
    /**
     * Probe Claude CLI for supported models (best effort).
     */
    listSupportedModels(timeoutMs?: number): Promise<ClaudeSupportedModelsResponse>;
    /**
     * Set max thinking tokens for the session
     */
    setMaxThinkingTokens(maxTokens: number): Promise<void>;
    /**
     * Send an MCP server message to the CLI
     */
    sendMcpMessage(serverName: string, message: any): Promise<void>;
    /**
     * Send an MCP response back to the CLI for a control_request.
     */
    sendMcpControlResponse(requestId: string, mcpResponse: any): Promise<void>;
    /**
     * Send a control_request and optionally wait for a control_response.
     */
    sendControlRequest(request: any, timeoutMs?: number): Promise<any>;
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
    private normalizeSupportedModels;
    private handleTaskMessage;
}
