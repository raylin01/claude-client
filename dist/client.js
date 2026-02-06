"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeClient = void 0;
const child_process_1 = require("child_process");
const readline_1 = require("readline");
const events_1 = require("events");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const DEBUG_LOG = '/Users/ray/Documents/DisCode/claude_debug.log';
function debugLog(msg) {
    try {
        (0, fs_1.appendFileSync)(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`);
    }
    catch (e) {
        // ignore
    }
}
class ClaudeClient extends events_1.EventEmitter {
    process = null;
    stdinReady = false;
    config;
    buffer = '';
    readyEmitted = false;
    // Track current state
    _sessionId = null;
    _isThinking = false;
    // Accumulated content for streaming mode
    _accumulatedText = '';
    _accumulatedThinking = '';
    // Tool input accumulation (input is streamed via input_json_delta)
    _currentToolBlock = null;
    // Status tracking
    _status = 'idle';
    _pendingAction = null;
    // Message queue for when Claude is busy
    _messageQueue = [];
    _isProcessingMessage = false;
    constructor(config) {
        super();
        this.config = config;
        if (config.sessionId) {
            this._sessionId = config.sessionId;
        }
    }
    get sessionId() {
        return this._sessionId;
    }
    /**
     * Get current session status
     */
    getStatus() {
        return this._status;
    }
    /**
     * Get pending action (if status is 'input_needed')
     */
    getPendingAction() {
        return this._pendingAction;
    }
    /**
     * Check if currently processing a message
     */
    isProcessing() {
        return this._isProcessingMessage;
    }
    /**
     * Queue a message to be sent when Claude is ready
     * If not processing, sends immediately
     */
    queueMessage(text) {
        if (this._isProcessingMessage) {
            this._messageQueue.push(text);
            debugLog(`Message queued (queue size: ${this._messageQueue.length})`);
        }
        else {
            this.sendMessage(text);
        }
    }
    /**
     * Process next message in queue (called after result received)
     */
    processNextQueuedMessage() {
        if (this._messageQueue.length > 0) {
            const nextMessage = this._messageQueue.shift();
            debugLog(`Processing queued message (${this._messageQueue.length} remaining)`);
            this.sendMessage(nextMessage);
        }
    }
    /**
     * Update status and emit event
     */
    setStatus(status, pendingAction = null) {
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
    async start() {
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
                this.process = (0, child_process_1.spawn)(claudeBin, args, {
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
                const rl = (0, readline_1.createInterface)({
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
            }
            catch (error) {
                reject(error);
            }
        });
    }
    async sendMessage(text) {
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
    async sendControlResponse(requestId, responseData) {
        debugLog(`Sending control_response: request_id=${requestId} behavior=${responseData.behavior} scope=${responseData.scope || 'none'}`);
        if (this.config.debug) {
            console.log(`[ClaudeClient] Sending control_response: request_id=${requestId} behavior=${responseData.behavior} scope=${responseData.scope || 'none'}`);
        }
        const message = {
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
    async interrupt() {
        debugLog('Sending interrupt control request');
        await this.writeToStdin({
            type: 'control_request',
            request_id: (0, crypto_1.randomUUID)(),
            request: { subtype: 'interrupt' }
        });
    }
    /**
     * Terminate the session
     */
    kill() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }
    /**
     * Send a message with multiple content blocks (text, images, etc.)
     */
    async sendMessageWithContent(content) {
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
    async writeToStdin(data) {
        if (!this.process || !this.process.stdin) {
            throw new Error('Process not running');
        }
        const json = JSON.stringify(data);
        if (!this.process.stdin.write(json + '\n')) {
            await new Promise((resolve) => {
                this.process?.stdin?.once('drain', resolve);
            });
        }
    }
    processLine(line) {
        if (!line.trim())
            return;
        debugLog(`Received line: ${line}`);
        try {
            const message = JSON.parse(line);
            this.handleMessage(message);
        }
        catch (error) {
            if (this.config.debug) {
                console.error('Failed to parse JSON:', error, line);
            }
            debugLog(`Failed to parse JSON: ${error} Line: ${line}`);
        }
    }
    handleMessage(message) {
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
                debugLog(`Control request: id=${message.request_id} subtype=${message.request.subtype} tool=${message.request.tool_name || 'n/a'}`);
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
                const resMessage = message;
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
    handleStreamEvent(event) {
        switch (event.type) {
            case 'message_start':
                // Reset accumulators for new message
                this._accumulatedText = '';
                this._accumulatedThinking = '';
                break;
            case 'content_block_delta':
                const delta = event.delta;
                if (delta.type === 'text_delta' && delta.text) {
                    this._accumulatedText += delta.text;
                    this.emit('text_delta', delta.text); // Delta for backwards compat
                    this.emit('text_accumulated', this._accumulatedText); // Full accumulated
                }
                else if (delta.type === 'thinking_delta' && delta.thinking) {
                    this._isThinking = true;
                    this._accumulatedThinking += delta.thinking;
                    this.emit('thinking_delta', delta.thinking); // Delta for backwards compat
                    this.emit('thinking_accumulated', this._accumulatedThinking); // Full accumulated
                }
                else if (delta.type === 'input_json_delta' && delta.partial_json) {
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
                    }
                    catch (e) {
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
    getMaxThinkingTokens() {
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
    handleToolResults(message) {
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
exports.ClaudeClient = ClaudeClient;
