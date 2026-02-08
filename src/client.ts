
import { spawn, ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { appendFileSync } from 'fs';
import { join } from 'path';

const DEBUG_LOG = '/Users/ray/Documents/DisCode/claude_debug.log';
function debugLog(msg: string) {
    try {
        appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`);
    } catch (e) {
        // ignore
    }
}

import { 
    SystemMessage, 
    CliMessage, 
    StreamEvent, 
    ContentDelta, 
    Usage, 
    AssistantMessage, 
    UserMessage,
    ControlRequestMessage,
    ControlResponseMessage,
    InputMessage,
    ResultMessage,
    Suggestion,
    PermissionScope,
    StreamEventMessage,
    ControlResponseData,
    ControlCancelRequestMessage,
    SystemMessage,
    McpMessageRequest,
    McpMessageEvent,
    HookCallbackEvent,
    ControlResponseEnvelope,
    TaskMessageEvent
} from './types.js';
import type { TaskStore } from './task-store.js';
import type { TaskMessageQueue } from './task-queue.js';

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
    permissionMode?: 'default' | 'acceptEdits';
    /**
     * Allow skipping permissions dangerously (passes --allow-dangerously-skip-permissions)
     */
    allowDangerouslySkipPermissions?: boolean;
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
     * Plugins to load (passes --plugin-dir)
     */
    plugins?: Array<{ type: 'local'; path: string }>;
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

export class ClaudeClient extends EventEmitter {
    private process: ChildProcess | null = null;
    private stdinReady = false;
    private config: ClaudeClientConfig;
    private buffer = '';
    private readyEmitted = false;
    
    // Track current state
    private _sessionId: string | null = null;
    private _isThinking = false;
    
    // Accumulated content for streaming mode
    private _accumulatedText = '';
    private _accumulatedThinking = '';
    
    // Tool input accumulation (input is streamed via input_json_delta)
    private _currentToolBlock: { id: string; name: string; inputJson: string } | null = null;
    
    // Status tracking
    private _status: SessionStatus = 'idle';
    private _pendingAction: PendingAction | null = null;
    private pendingControlRequests = new Map<string, ControlRequestMessage>();
    private pendingControlResponses = new Map<string, {
        resolve: (value: any) => void;
        reject: (error: Error) => void;
        timeout: NodeJS.Timeout;
    }>();
    private taskStore: TaskStore | null = null;
    private taskQueue: TaskMessageQueue | null = null;
    private readonly mcpResponseTimeoutMs = parseInt(process.env.CLAUDE_CLIENT_MCP_TIMEOUT_MS || '2000');
    
    // Message queue for when Claude is busy
    private _messageQueue: string[] = [];
    private _isProcessingMessage = false;

    constructor(config: ClaudeClientConfig) {
        super();
        this.config = config;
        if (config.sessionId) {
            this._sessionId = config.sessionId;
        }
        this.taskStore = config.taskStore || null;
        this.taskQueue = config.taskQueue || null;
    }

    get sessionId(): string | null {
        return this._sessionId;
    }

    /**
     * Get current session status
     */
    getStatus(): SessionStatus {
        return this._status;
    }

    /**
     * Get pending action (if status is 'input_needed')
     */
    getPendingAction(): PendingAction | null {
        return this._pendingAction;
    }

    /**
     * Check if currently processing a message
     */
    isProcessing(): boolean {
        return this._isProcessingMessage;
    }

    /**
     * Queue a message to be sent when Claude is ready
     * If not processing, sends immediately
     */
    queueMessage(text: string): void {
        if (this._isProcessingMessage) {
            this._messageQueue.push(text);
            debugLog(`Message queued (queue size: ${this._messageQueue.length})`);
        } else {
            this.sendMessage(text);
        }
    }

    /**
     * Process next message in queue (called after result received)
     */
    private processNextQueuedMessage(): void {
        if (this._messageQueue.length > 0) {
            const nextMessage = this._messageQueue.shift()!;
            debugLog(`Processing queued message (${this._messageQueue.length} remaining)`);
            this.sendMessage(nextMessage);
        }
    }

    /**
     * Update status and emit event
     */
    private setStatus(status: SessionStatus, pendingAction: PendingAction | null = null): void {
        const changed = this._status !== status || 
            JSON.stringify(this._pendingAction) !== JSON.stringify(pendingAction);
        
        this._status = status;
        this._pendingAction = pendingAction;
        
        if (changed) {
            this.emit('status_change', status, pendingAction);
        }
    }

    /**
     * Start the Claude CLI process
     */
    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const claudePath = this.config.claudePath || 'claude';
                const args = [
                    '--output-format', 'stream-json',
                    '--verbose',
                    '--input-format', 'stream-json',
                    ...(this.config.args || [])
                ];

                const includePartial = this.config.includePartialMessages !== false;
                if (includePartial) {
                    args.push('--include-partial-messages');
                }

                if (this.config.permissionPromptToolName) {
                    args.push('--permission-prompt-tool', this.config.permissionPromptToolName);
                } else {
                    const permissionPrompt = this.config.permissionPromptTool !== false;
                    if (permissionPrompt) {
                        args.push('--permission-prompt-tool', 'stdio');
                    }
                }

                // Add max-thinking-tokens if enabled
                const maxTokens = this.getMaxThinkingTokens();
                if (maxTokens > 0) {
                    args.push('--max-thinking-tokens', maxTokens.toString());
                    if (this.config.debug) {
                        console.log(`Extended thinking enabled: ${maxTokens} tokens`);
                    }
                }

                if (this.config.continueConversation) {
                    args.push('--continue');
                }
                if (this.config.resumeSessionId) {
                    args.push('--resume', this.config.resumeSessionId);
                }
                if (this.config.maxTurns && this.config.maxTurns > 0) {
                    args.push('--max-turns', this.config.maxTurns.toString());
                }
                if (this.config.maxBudgetUsd !== undefined) {
                    args.push('--max-budget-usd', this.config.maxBudgetUsd.toString());
                }
                if (this.config.model) {
                    args.push('--model', this.config.model);
                }
                if (this.config.fallbackModel) {
                    if (this.config.model && this.config.fallbackModel === this.config.model) {
                        throw new Error('Fallback model cannot be the same as the main model.');
                    }
                    args.push('--fallback-model', this.config.fallbackModel);
                }
                if (this.config.agent) {
                    args.push('--agent', this.config.agent);
                }
                if (this.config.betas && this.config.betas.length > 0) {
                    args.push('--betas', this.config.betas.join(','));
                }
                if (this.config.jsonSchema) {
                    const schemaValue = typeof this.config.jsonSchema === 'string'
                        ? this.config.jsonSchema
                        : JSON.stringify(this.config.jsonSchema);
                    args.push('--json-schema', schemaValue);
                }
                if (this.config.permissionMode) {
                    args.push('--permission-mode', this.config.permissionMode);
                }
                if (this.config.allowDangerouslySkipPermissions) {
                    args.push('--allow-dangerously-skip-permissions');
                }
                if (this.config.allowedTools && this.config.allowedTools.length > 0) {
                    args.push('--allowedTools', this.config.allowedTools.join(','));
                }
                if (this.config.disallowedTools && this.config.disallowedTools.length > 0) {
                    args.push('--disallowedTools', this.config.disallowedTools.join(','));
                }
                if (this.config.tools !== undefined) {
                    if (Array.isArray(this.config.tools)) {
                        args.push('--tools', this.config.tools.length === 0 ? '' : this.config.tools.join(','));
                    } else {
                        args.push('--tools', 'default');
                    }
                }
                if (this.config.mcpServers && Object.keys(this.config.mcpServers).length > 0) {
                    args.push('--mcp-config', JSON.stringify({ mcpServers: this.config.mcpServers }));
                }
                if (this.config.settingSources && this.config.settingSources.length > 0) {
                    args.push('--setting-sources', this.config.settingSources.join(','));
                }
                if (this.config.strictMcpConfig) {
                    args.push('--strict-mcp-config');
                }
                if (this.config.additionalDirectories && this.config.additionalDirectories.length > 0) {
                    for (const dir of this.config.additionalDirectories) {
                        args.push('--add-dir', dir);
                    }
                }
                if (this.config.plugins && this.config.plugins.length > 0) {
                    for (const plugin of this.config.plugins) {
                        if (plugin.type !== 'local') {
                            throw new Error(`Unsupported plugin type: ${plugin.type}`);
                        }
                        args.push('--plugin-dir', plugin.path);
                    }
                }
                if (this.config.forkSession) {
                    args.push('--fork-session');
                }
                if (this.config.resumeSessionAt) {
                    args.push('--resume-session-at', this.config.resumeSessionAt);
                }
                const extraArgs = { ...(this.config.extraArgs || {}) } as Record<string, any>;
                if (this.config.sandbox) {
                    let settingsObj: Record<string, any> = { sandbox: this.config.sandbox };
                    if (extraArgs.settings) {
                        if (typeof extraArgs.settings === 'string') {
                            try {
                                settingsObj = { ...JSON.parse(extraArgs.settings), sandbox: this.config.sandbox };
                            } catch (err) {
                                throw new Error('Failed to parse extraArgs.settings JSON while applying sandbox.');
                            }
                        } else if (typeof extraArgs.settings === 'object') {
                            settingsObj = { ...extraArgs.settings, sandbox: this.config.sandbox };
                        } else {
                            throw new Error('extraArgs.settings must be a string or object when sandbox is set.');
                        }
                    }
                    extraArgs.settings = JSON.stringify(settingsObj);
                }
                for (const [key, value] of Object.entries(extraArgs)) {
                    if (value === null) {
                        args.push(`--${key}`);
                    } else {
                        const val = typeof value === 'string' ? value : JSON.stringify(value);
                        args.push(`--${key}`, val);
                    }
                }

                if (this.config.persistSession === false) {
                    args.push('--no-session-persistence');
                }

                const isScript = /\.(js|mjs|cjs|ts|tsx|jsx)$/.test(claudePath);
                const spawnBin = isScript ? (this.config.executable || 'node') : claudePath;
                const spawnArgs = isScript
                    ? [...(this.config.executableArgs || []), claudePath, ...args]
                    : args;

                if (this.config.debug) {
                    console.log(`Spawning: ${spawnBin} ${spawnArgs.join(' ')}`);
                }
                debugLog(`Spawning: ${spawnBin} ${spawnArgs.join(' ')}`);

                this.process = spawn(spawnBin, spawnArgs, {
                    cwd: this.config.cwd,
                    env: {
                        ...process.env,
                        ...this.config.env,
                        // Ensure we don't prompt for auth if possible
                        // But use the entrypoint from legacy code which seems critical
                        CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
                        ...(this.config.enableFileCheckpointing ? { CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: 'true' } : {}),
                        CI: 'true', 
                    },
                    stdio: ['pipe', 'pipe', 'pipe'],
                    windowsHide: true
                });

                if (!this.process.stdin || !this.process.stdout || !this.process.stderr) {
                    throw new Error('Failed to create process pipes');
                }

                // Handle stdout (JSON stream)
                const rl = createInterface({
                    input: this.process.stdout,
                    crlfDelay: Infinity
                });

                rl.on('line', (line) => this.processLine(line));

                // Handle stderr (logs/errors)
                this.process.stderr.on('data', (data) => {
                    const str = data.toString();
                    debugLog(`Stderr: ${str}`);
                    if (this.config.debug) {
                        console.error(`[Claude CLI Stderr]: ${str}`);
                    }
                    // Some crucial errors might come here
                });

                this.process.on('error', (err) => {
                    this.emit('error', err);
                    debugLog(`Process error: ${err.message}`);
                    reject(err);
                });

                this.process.on('exit', (code) => {
                    this.emit('exit', code);
                    debugLog(`Process exited with code: ${code}`);
                    this.process = null;
                    this.stdinReady = false;
                    this.readyEmitted = false;
                });

                this.process.stdin.on('drain', () => {
                    this.stdinReady = true;
                });
                
                this.stdinReady = true;

                // Emit ready after spawn so callers can proceed even if
                // system/init is delayed or not emitted until first input.
                setTimeout(() => {
                    if (!this.readyEmitted && this.process) {
                        this.readyEmitted = true;
                        this.emit('ready');
                    }
                }, 100);
                
                // We consider it started once the process is spawned, 
                // but 'ready' event implies system init is done.
                resolve();

            } catch (error) {
                reject(error);
            }
        });
    }

    async sendMessage(text: string): Promise<void> {
        this._isProcessingMessage = true;
        this.setStatus('running');
        
        const message = {
            type: 'user',
            session_id: this._sessionId || this.config.sessionId || 'pending',
            message: {
                role: 'user',
                content: [{ type: 'text', text }]
            },
            parent_tool_use_id: null
        };

        await this.writeToStdin(message);
    }

    /**
     * Send a control response (permission decision, answer, etc.)
     */
    async sendControlResponse(requestId: string, responseData: ControlResponseData): Promise<void> {
        debugLog(`Sending control_response: request_id=${requestId} behavior=${responseData.behavior} scope=${(responseData as any).scope || 'none'}`);
        if (this.config.debug) {
            console.log(`[ClaudeClient] Sending control_response: request_id=${requestId} behavior=${responseData.behavior} scope=${(responseData as any).scope || 'none'}`);
        }
        const message: ControlResponseMessage = {
            type: 'control_response',
            request_id: requestId,
            subtype: 'success', // Assuming success for now
            response: responseData
        };
        
        // Wrap in the outer structure expected by CLI if needed, 
        // based on plugin implementation:
        // plugin sends: { type: 'control_response', response: { ... } }
        
        await this.writeToStdin({
            type: 'control_response',
            response: {
                subtype: 'success',
                request_id: requestId,
                response: responseData
            }
        });
    }

    /**
     * Interrupt current operation (like Ctrl+C but via protocol)
     */
    async interrupt(): Promise<void> {
        debugLog('Sending interrupt control request');
        await this.sendControlRequest({ subtype: 'interrupt' });
    }

    /**
     * Set permission mode (default or acceptEdits)
     */
    async setPermissionMode(mode: 'default' | 'acceptEdits'): Promise<void> {
        await this.sendControlRequest({ subtype: 'set_permission_mode', mode });
    }

    /**
     * Set model for the session
     */
    async setModel(model: string): Promise<void> {
        await this.sendControlRequest({ subtype: 'set_model', model });
    }

    /**
     * Set max thinking tokens for the session
     */
    async setMaxThinkingTokens(maxTokens: number): Promise<void> {
        await this.sendControlRequest({ subtype: 'set_max_thinking_tokens', max_thinking_tokens: maxTokens });
    }

    /**
     * Send an MCP server message to the CLI
     */
    async sendMcpMessage(serverName: string, message: any): Promise<void> {
        const request: McpMessageRequest = {
            subtype: 'mcp_message',
            server_name: serverName,
            message
        };
        await this.sendControlRequest(request);
    }

    /**
     * Send an MCP response back to the CLI for a control_request.
     */
    async sendMcpControlResponse(requestId: string, mcpResponse: any): Promise<void> {
        await this.writeToStdin({
            type: 'control_response',
            response: {
                subtype: 'success',
                request_id: requestId,
                response: {
                    mcp_response: mcpResponse
                }
            }
        });
    }

    /**
     * Send a control_request and optionally wait for a control_response.
     */
    async sendControlRequest(request: any, timeoutMs: number = 5000): Promise<any> {
        const requestId = randomUUID();

        const promise = new Promise<any>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingControlResponses.delete(requestId);
                reject(new Error(`control_response timeout for ${requestId}`));
            }, timeoutMs);

            this.pendingControlResponses.set(requestId, { resolve, reject, timeout });
        });

        await this.writeToStdin({
            type: 'control_request',
            request_id: requestId,
            request
        });

        return promise;
    }

    /**
     * Terminate the session
     */
    kill(): void {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }

    /**
     * Send a message with multiple content blocks (text, images, etc.)
     */
    async sendMessageWithContent(content: Array<{ type: string; [key: string]: any }>): Promise<void> {
        const message = {
            type: 'user',
            session_id: this._sessionId || this.config.sessionId || 'pending',
            message: {
                role: 'user',
                content
            },
            parent_tool_use_id: null
        };

        await this.writeToStdin(message);
    }

    private async writeToStdin(data: any): Promise<void> {
        if (!this.process || !this.process.stdin) {
            throw new Error('Process not running');
        }

        const json = JSON.stringify(data);
        if (!this.process.stdin.write(json + '\n')) {
            await new Promise<void>((resolve) => {
                this.process?.stdin?.once('drain', resolve);
            });
        }
    }

    private processLine(line: string): void {
        if (!line.trim()) return;
        debugLog(`Received line: ${line}`);

        try {
            const message = JSON.parse(line) as CliMessage;
            this.handleMessage(message);
        } catch (error) {
            if (this.config.debug) {
                console.error('Failed to parse JSON:', error, line);
            }
            debugLog(`Failed to parse JSON: ${error} Line: ${line}`);
        }
    }

    private handleMessage(message: CliMessage): void {
        debugLog(`Received message type=${message.type}`);
        // Emit ready on first successful message if we haven't yet
        // (This acts as a fallback if system/init is missed or not sent first)
        if (this._sessionId === null && 'session_id' in message && message.session_id) {
            this._sessionId = message.session_id;
            if (!this.readyEmitted) {
                this.readyEmitted = true;
                this.emit('ready');
            }
        }

        switch (message.type) {
            case 'system':
                if (message.subtype === 'init') {
                    debugLog(`System init: session_id=${message.session_id}`);
                    this._sessionId = message.session_id;
                    if (!this.readyEmitted) {
                        this.readyEmitted = true;
                        this.emit('ready');
                    }
                    this.emit('system', message);
                }
                break;
            
            case 'stream_event':
                this.emit('stream_event', message);
                this.handleStreamEvent(message.event);
                break;

            case 'assistant':
                this.emit('message', message);
                break;

            case 'user':
                this.emit('user_message', message);
                // Emit tool_result events for each tool result in the message
                this.handleToolResults(message);
                break;

            case 'control_request':
                debugLog(`Control request: id=${message.request_id} subtype=${message.request.subtype} tool=${(message.request as any).tool_name || 'n/a'}`);
                this.pendingControlRequests.set(message.request_id, message);
                
                // Update status to input_needed with pending action details
                const req = message.request;
                if (req.subtype === 'can_use_tool') {
                    const isQuestion = req.tool_name === 'AskUserQuestion';
                    this.setStatus('input_needed', {
                        type: isQuestion ? 'question' : 'permission',
                        requestId: message.request_id,
                        toolName: req.tool_name,
                        input: req.input,
                        question: isQuestion ? req.input?.question : undefined,
                        options: isQuestion ? req.input?.options : undefined
                    });
                }
                
                this.emit('control_request', message);

                if (req.subtype === 'mcp_message') {
                    const serverName = (req as any).server_name;
                    const msg = (req as any).message;
                    let responded = false;
                    let timeout: NodeJS.Timeout | null = null;
                    const respond = async (mcpResponse: any) => {
                        if (responded) return;
                        responded = true;
                        if (timeout) {
                            clearTimeout(timeout);
                            timeout = null;
                        }
                        await this.sendMcpControlResponse(message.request_id, mcpResponse);
                    };

                    if (this.listenerCount('mcp_message') === 0) {
                        const defaultResponse = {
                            jsonrpc: '2.0',
                            result: {},
                            id: msg && typeof msg.id !== 'undefined' ? msg.id : 0
                        };
                        void respond(defaultResponse);
                    } else {
                        timeout = setTimeout(() => {
                            if (responded) return;
                            const defaultResponse = {
                                jsonrpc: '2.0',
                                result: {},
                                id: msg && typeof msg.id !== 'undefined' ? msg.id : 0
                            };
                            void respond(defaultResponse);
                        }, this.mcpResponseTimeoutMs);

                        this.emit('mcp_message', {
                            serverName,
                            message: msg,
                            requestId: message.request_id,
                            respond
                        });

                        // Best-effort cleanup of timeout if response is sent quickly
                        // Fallback timeout will auto-respond if no handler replies.
                    }
                }

                if (req.subtype === 'hook_callback') {
                    let responded = false;
                    const respond = async (responseData: ControlResponseData) => {
                        if (responded) return;
                        responded = true;
                        await this.sendControlResponse(message.request_id, responseData);
                    };

                    if (this.listenerCount('hook_callback') === 0) {
                        void respond({
                            behavior: 'allow',
                            updatedInput: req.input || {},
                            message: 'OK'
                        });
                    } else {
                        this.emit('hook_callback', {
                            callbackId: (req as any).callback_id,
                            input: req.input,
                            toolUseId: (req as any).tool_use_id,
                            requestId: message.request_id,
                            respond
                        });
                    }
                }
                break;

            case 'control_response':
                this.emit('control_response', message as ControlResponseEnvelope);
                if ((message as any).response?.request_id) {
                    const response = message as ControlResponseEnvelope;
                    const pending = this.pendingControlResponses.get(response.response.request_id);
                    if (pending) {
                        clearTimeout(pending.timeout);
                        this.pendingControlResponses.delete(response.response.request_id);
                        pending.resolve(response.response);
                    }
                }
                break;

            case 'control_cancel_request':
                this.pendingControlRequests.delete(message.request_id);
                if (this._pendingAction && this._pendingAction.requestId === message.request_id) {
                    this.setStatus('idle', null);
                }
                this.emit('control_cancel_request', message);
                break;

            case 'result':
                const resMessage = message as ResultMessage;
                debugLog(`Result received: subtype=${resMessage.subtype} duration=${resMessage.duration_ms}ms`);
                
                // Update status and process queue
                this._isProcessingMessage = false;
                this.setStatus(resMessage.is_error ? 'error' : 'idle');
                
                this.emit('result', resMessage);
                
                // Process next queued message if any
                this.processNextQueuedMessage();
                break;

            case 'keep_alive':
                // minimal handling
                break;

            default:
                debugLog(`Unhandled message type: ${message.type} - ${JSON.stringify(message).slice(0, 200)}`);
                break;
        }

        // Task routing (best-effort)
        this.handleTaskMessage(message);
    }

    private handleStreamEvent(event: any): void {
        switch (event.type) {
            case 'message_start':
                // Reset accumulators for new message
                this._accumulatedText = '';
                this._accumulatedThinking = '';
                break;
                
            case 'content_block_delta':
                const delta = event.delta as ContentDelta;
                if (delta.type === 'text_delta' && delta.text) {
                    this._accumulatedText += delta.text;
                    this.emit('text_delta', delta.text);  // Delta for backwards compat
                    this.emit('text_accumulated', this._accumulatedText);  // Full accumulated
                } else if (delta.type === 'thinking_delta' && delta.thinking) {
                    this._isThinking = true;
                    this._accumulatedThinking += delta.thinking;
                    this.emit('thinking_delta', delta.thinking);  // Delta for backwards compat
                    this.emit('thinking_accumulated', this._accumulatedThinking);  // Full accumulated
                } else if (delta.type === 'input_json_delta' && delta.partial_json) {
                    // Accumulate tool input JSON
                    if (this._currentToolBlock) {
                        this._currentToolBlock.inputJson += delta.partial_json;
                    }
                }
                break;
            
            case 'content_block_start':
                if (event.content_block?.type === 'tool_use') {
                    // Start tracking tool block - input will be accumulated via deltas
                    this._currentToolBlock = {
                        id: event.content_block.id,
                        name: event.content_block.name,
                        inputJson: ''
                    };
                }
                break;

            case 'content_block_stop':
                // Tool execution completed - emit with accumulated input
                if (this._currentToolBlock) {
                    let parsedInput = {};
                    try {
                        if (this._currentToolBlock.inputJson) {
                            parsedInput = JSON.parse(this._currentToolBlock.inputJson);
                        }
                    } catch (e) {
                        debugLog(`Failed to parse tool input JSON: ${this._currentToolBlock.inputJson}`);
                    }
                    
                    this.emit('tool_use_start', {
                        id: this._currentToolBlock.id,
                        name: this._currentToolBlock.name,
                        input: parsedInput
                    });
                    this._currentToolBlock = null;
                }
                break;

                break;

            case 'message_delta':
                // Contains usage stats
                if (event.usage) {
                    this.emit('usage_update', event.usage);
                }
                break;

            case 'message_stop':
                // Message completed
                break;

            default:
                debugLog(`Unhandled stream event type: ${event.type} - ${JSON.stringify(event).slice(0, 200)}`);
                break;
        }
    }

    /**
     * Get max thinking tokens based on thinking level setting
     */
    private getMaxThinkingTokens(): number {
        // If explicitly set in config
        if (this.config.thinking?.maxTokens !== undefined) {
            return this.config.thinking.maxTokens;
        }

        // Otherwise, determine from thinking level
        const level = this.config.thinking?.level || 'default_on';

        if (level === 'off') {
            return 0;
        }

        // Default for enabled thinking
        return 31999;
    }

    /**
     * Parse tool results from user messages and emit events
     */
    private handleToolResults(message: UserMessage): void {
        const content = message.message?.content || message.content || [];
        
        for (const block of content) {
            if (block.type === 'tool_result') {
                this.emit('tool_result', {
                    toolUseId: block.tool_use_id,
                    content: block.content || '',
                    isError: block.is_error === true
                });
            }
        }
    }

    private handleTaskMessage(message: any): void {
        const taskId = extractRelatedTaskId(message, 6);
        if (!taskId) return;

        const event: TaskMessageEvent = {
            taskId,
            sessionId: this._sessionId || undefined,
            message,
            timestamp: new Date()
        };

        if (this.taskQueue) {
            void this.taskQueue.enqueue(taskId, {
                taskId,
                sessionId: event.sessionId,
                message,
                timestamp: event.timestamp
            });
        }

        this.emit('task_message', event);
    }
}

const RELATED_TASK_KEY = 'io.modelcontextprotocol/related-task';

function extractRelatedTaskId(payload: any, maxDepth: number): string | null {
    if (!payload || typeof payload !== 'object') return null;

    const stack = [{ value: payload, depth: 0 }];
    const visited = new Set<any>();

    while (stack.length > 0) {
        const currentEntry = stack.pop();
        if (!currentEntry) continue;
        const { value: current, depth } = currentEntry;
        if (!current || typeof current !== 'object') continue;
        if (visited.has(current)) continue;
        visited.add(current);

        if (depth > maxDepth) continue;

        const meta = (current as any)._meta;
        if (meta && meta[RELATED_TASK_KEY] && meta[RELATED_TASK_KEY].taskId) {
            return String(meta[RELATED_TASK_KEY].taskId);
        }

        for (const value of Object.values(current)) {
            if (value && typeof value === 'object') {
                stack.push({ value, depth: depth + 1 });
            }
        }
    }

    return null;
}
