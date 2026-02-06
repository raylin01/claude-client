
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
    ControlResponseData
} from './types.js';

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
    
    // Message queue for when Claude is busy
    private _messageQueue: string[] = [];
    private _isProcessingMessage = false;

    constructor(config: ClaudeClientConfig) {
        super();
        this.config = config;
        if (config.sessionId) {
            this._sessionId = config.sessionId;
        }
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
                const claudeBin = this.config.claudePath || 'claude';
                const args = [
                    '--output-format', 'stream-json',
                    '--verbose',
                    '--input-format', 'stream-json',
                    '--include-partial-messages',
                    '--permission-prompt-tool', 'stdio',
                    ...(this.config.args || [])
                ];

                // Add max-thinking-tokens if enabled
                const maxTokens = this.getMaxThinkingTokens();
                if (maxTokens > 0) {
                    args.push('--max-thinking-tokens', maxTokens.toString());
                    if (this.config.debug) {
                        console.log(`Extended thinking enabled: ${maxTokens} tokens`);
                    }
                }

                if (this.config.debug) {
                    console.log(`Spawning: ${claudeBin} ${args.join(' ')}`);
                }
                debugLog(`Spawning: ${claudeBin} ${args.join(' ')}`);

                this.process = spawn(claudeBin, args, {
                    cwd: this.config.cwd,
                    env: {
                        ...process.env,
                        ...this.config.env,
                        // Ensure we don't prompt for auth if possible
                        // But use the entrypoint from legacy code which seems critical
                        CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
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
        await this.writeToStdin({
            type: 'control_request',
            request_id: randomUUID(),
            request: { subtype: 'interrupt' }
        });
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
}
