
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
    CliMessage, 
    SystemMessage, 
    StreamEventMessage, 
    AssistantMessage, 
    UserMessage, 
    ControlRequestMessage, 
    ControlResponseMessage, 
    ControlResponseData,
    ContentDelta,
    Suggestion,
    PermissionScope
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

export declare interface ClaudeClient {
    on(event: 'ready', listener: () => void): this;
    on(event: 'message', listener: (message: AssistantMessage) => void): this;
    on(event: 'stream_event', listener: (event: StreamEventMessage) => void): this;
    on(event: 'text_delta', listener: (text: string) => void): this;
    on(event: 'thinking_delta', listener: (thinking: string) => void): this;
    on(event: 'text_accumulated', listener: (text: string) => void): this;
    on(event: 'thinking_accumulated', listener: (thinking: string) => void): this;
    on(event: 'tool_use', listener: (tool: any) => void): this; // Generic tool use
    on(event: 'control_request', listener: (request: ControlRequestMessage) => void): this;
    on(event: 'user_message', listener: (message: UserMessage) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'exit', listener: (code: number | null) => void): this;
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

    /**
     * Send a user message to Claude
     */
    async sendMessage(text: string): Promise<void> {
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
     * Terminate the session
     */
    kill(): void {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
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
                break;

            case 'control_request':
                debugLog(`Control request: id=${message.request_id} subtype=${message.request.subtype} tool=${(message.request as any).tool_name || 'n/a'}`);
                this.emit('control_request', message);
                break;

            case 'keep_alive':
                // minimal handling
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
                }
                break;
            
            // Add specific handling for tool use start if needed
            case 'content_block_start':
                if (event.content_block?.type === 'tool_use') {
                    // emit generic tool use event ?
                }
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
}
