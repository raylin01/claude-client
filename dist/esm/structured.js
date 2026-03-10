import { EventEmitter } from 'events';
import { ClaudeClient } from './client.js';
function nowIso() {
    return new Date().toISOString();
}
function normalizeSendInput(input) {
    if (typeof input === 'string') {
        return input;
    }
    if ('text' in input) {
        return { text: input.text };
    }
    return {
        content: input.content.map((block) => ({ ...block }))
    };
}
function cloneQuestionPrompt(prompt) {
    return {
        ...prompt,
        options: prompt.options.map((option) => ({ ...option }))
    };
}
function cloneOpenRequest(request) {
    if (request.kind === 'question') {
        return {
            ...request,
            questions: request.questions.map(cloneQuestionPrompt)
        };
    }
    if (request.kind === 'tool_approval') {
        return {
            ...request,
            input: { ...request.input },
            suggestions: request.suggestions.map((suggestion) => ({ ...suggestion }))
        };
    }
    if (request.kind === 'hook') {
        return {
            ...request,
            input: { ...request.input }
        };
    }
    return {
        ...request,
        message: request.message
    };
}
function cloneHistoryEntry(entry) {
    return {
        ...entry,
        toolUse: entry.toolUse ? { ...entry.toolUse, input: { ...entry.toolUse.input } } : undefined,
        toolResult: entry.toolResult ? { ...entry.toolResult } : undefined,
        request: entry.request ? cloneOpenRequest(entry.request) : undefined,
        message: entry.message ? { ...entry.message } : undefined,
        result: entry.result ? { ...entry.result } : undefined
    };
}
function cloneSnapshot(snapshot) {
    return {
        ...snapshot,
        currentMessage: { ...snapshot.currentMessage },
        toolUses: snapshot.toolUses.map((toolUse) => ({ ...toolUse, input: { ...toolUse.input } })),
        toolResults: snapshot.toolResults.map((toolResult) => ({ ...toolResult })),
        openRequests: snapshot.openRequests.map(cloneOpenRequest),
        history: snapshot.history.map(cloneHistoryEntry),
        usage: snapshot.usage ? { ...snapshot.usage } : undefined,
        result: snapshot.result ? { ...snapshot.result } : undefined,
        metadata: snapshot.metadata ? { ...snapshot.metadata } : undefined
    };
}
function toTextContent(input) {
    if (typeof input === 'string') {
        return input;
    }
    if ('text' in input) {
        return input.text;
    }
    return input.content
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n');
}
function buildQuestionPrompts(input) {
    const questions = Array.isArray(input)
        ? input
        : Array.isArray(input?.questions)
            ? input.questions
            : input?.question
                ? [input]
                : [];
    return questions.map((question, index) => {
        const options = Array.isArray(question?.options) ? question.options : [];
        const mappedOptions = options.map((option, optionIndex) => {
            if (typeof option === 'string') {
                return {
                    label: option,
                    value: option
                };
            }
            return {
                label: option?.label || option?.value || `Option ${optionIndex + 1}`,
                value: option?.value || option?.label || `option-${optionIndex + 1}`,
                description: typeof option?.description === 'string' ? option.description : undefined
            };
        });
        return {
            id: String(question?.id || question?.header || `question-${index + 1}`),
            header: typeof question?.header === 'string' ? question.header : undefined,
            prompt: String(question?.question || question?.prompt || 'Please provide input.'),
            options: mappedOptions,
            multiSelect: Boolean(question?.multiSelect)
        };
    });
}
function getQuestionLookupKeys(question) {
    const keys = [question.id, question.header, question.prompt].filter((value) => typeof value === 'string' && value.length > 0);
    return Array.from(new Set(keys));
}
function resolveQuestionPrompt(questions, questionKey) {
    if (typeof questionKey === 'number') {
        const question = questions[questionKey];
        if (!question) {
            throw new Error(`Unknown question index: ${questionKey}`);
        }
        return { index: questionKey, question };
    }
    const index = questions.findIndex((question) => getQuestionLookupKeys(question).includes(questionKey));
    if (index < 0) {
        throw new Error(`Unknown question: ${questionKey}`);
    }
    return { index, question: questions[index] };
}
export class ClaudeQuestionSession {
    client;
    request;
    answers = new Map();
    currentIndex;
    constructor(client, request) {
        this.client = client;
        this.request = cloneOpenRequest(request);
        this.currentIndex = Math.min(Math.max(request.currentQuestionIndex || 0, 0), Math.max(this.request.questions.length - 1, 0));
    }
    get requestId() {
        return this.request.id;
    }
    current() {
        return {
            requestId: this.request.id,
            request: cloneOpenRequest(this.request),
            currentIndex: this.currentIndex,
            answers: this.getAnswers()
        };
    }
    getCurrentQuestion() {
        return this.request.questions[this.currentIndex] ? cloneQuestionPrompt(this.request.questions[this.currentIndex]) : null;
    }
    getAnswers() {
        const values = {};
        for (const question of this.request.questions) {
            const answer = this.answers.get(question.id);
            if (answer !== undefined) {
                values[question.id] = Array.isArray(answer) ? [...answer] : answer;
            }
        }
        return values;
    }
    setAnswer(questionKey, answer) {
        const { question } = resolveQuestionPrompt(this.request.questions, questionKey);
        this.answers.set(question.id, Array.isArray(answer) ? [...answer] : answer);
        return this;
    }
    setCurrentAnswer(answer) {
        const question = this.getCurrentQuestion();
        if (!question) {
            throw new Error('No current question available.');
        }
        return this.setAnswer(question.id, answer);
    }
    next() {
        if (this.currentIndex < this.request.questions.length - 1) {
            this.currentIndex += 1;
        }
        return this.getCurrentQuestion();
    }
    previous() {
        if (this.currentIndex > 0) {
            this.currentIndex -= 1;
        }
        return this.getCurrentQuestion();
    }
    async submit() {
        await this.client.answerQuestion(this.request.id, this.getAnswers());
    }
}
class TurnHandle extends EventEmitter {
    session;
    snapshot;
    updateQueue = [];
    updateWaiters = [];
    done;
    resolveDone;
    rejectDone;
    constructor(session, id, input, metadata) {
        super();
        this.session = session;
        const startedAt = nowIso();
        this.snapshot = {
            id,
            input: normalizeSendInput(input),
            status: 'queued',
            currentOutputKind: 'idle',
            currentMessage: {
                type: 'idle',
                content: ''
            },
            text: '',
            thinking: '',
            toolUses: [],
            toolResults: [],
            openRequests: [],
            history: [
                {
                    kind: 'status',
                    status: 'queued',
                    timestamp: startedAt
                }
            ],
            startedAt,
            metadata
        };
        this.done = new Promise((resolve, reject) => {
            this.resolveDone = resolve;
            this.rejectDone = reject;
        });
    }
    current() {
        return cloneSnapshot(this.snapshot);
    }
    history() {
        return this.snapshot.history.map(cloneHistoryEntry);
    }
    getOpenRequests() {
        return this.snapshot.openRequests.map(cloneOpenRequest);
    }
    onUpdate(listener) {
        this.on('update', listener);
        return this;
    }
    async *updates() {
        while (true) {
            if (this.updateQueue.length > 0) {
                const update = this.updateQueue.shift();
                yield update;
                if (update.kind === 'completed' || update.kind === 'error') {
                    return;
                }
                continue;
            }
            const nextUpdate = await new Promise((resolve) => {
                this.updateWaiters.push(resolve);
            });
            if (!nextUpdate) {
                return;
            }
            yield nextUpdate;
            if (nextUpdate.kind === 'completed' || nextUpdate.kind === 'error') {
                return;
            }
        }
    }
    markQueued() {
        this.snapshot.status = 'queued';
        this.snapshot.history.push({
            kind: 'status',
            status: 'queued',
            timestamp: nowIso()
        });
        this.emitUpdate('queued');
    }
    markStarted() {
        this.snapshot.status = 'running';
        this.snapshot.history.push({
            kind: 'status',
            status: 'running',
            timestamp: nowIso()
        });
        this.emitUpdate('started');
    }
    updateStatus(status) {
        this.snapshot.status = status;
        this.snapshot.history.push({
            kind: 'status',
            status,
            timestamp: nowIso()
        });
    }
    updateOutput(kind, content) {
        this.snapshot.currentOutputKind = kind;
        this.snapshot.currentMessage = {
            type: kind,
            content
        };
        if (kind === 'text') {
            this.snapshot.text = content;
        }
        else if (kind === 'thinking') {
            this.snapshot.thinking = content;
        }
        this.snapshot.history.push({
            kind: 'output',
            outputKind: kind,
            content,
            message: { ...this.snapshot.currentMessage },
            timestamp: nowIso()
        });
        this.emitUpdate('output');
    }
    updateUsage(usage) {
        this.snapshot.usage = { ...usage };
    }
    addToolUse(tool) {
        const existingIndex = this.snapshot.toolUses.findIndex((entry) => entry.id === tool.id);
        if (existingIndex >= 0) {
            this.snapshot.toolUses[existingIndex] = tool;
        }
        else {
            this.snapshot.toolUses.push(tool);
        }
        this.snapshot.currentOutputKind = 'tool_use';
        this.snapshot.currentMessage = {
            type: 'tool_use',
            content: tool.name,
            toolName: tool.name,
            toolUseId: tool.id
        };
        this.snapshot.history.push({
            kind: 'tool_use',
            toolUse: { ...tool, input: { ...tool.input } },
            message: { ...this.snapshot.currentMessage },
            timestamp: nowIso()
        });
        this.emitUpdate('tool_use');
    }
    addToolResult(toolResult) {
        this.snapshot.toolResults.push({ ...toolResult });
        this.snapshot.currentOutputKind = 'tool_result';
        this.snapshot.currentMessage = {
            type: 'tool_result',
            content: toolResult.content,
            toolUseId: toolResult.toolUseId
        };
        this.snapshot.history.push({
            kind: 'tool_result',
            toolResult: { ...toolResult },
            message: { ...this.snapshot.currentMessage },
            timestamp: nowIso()
        });
        this.emitUpdate('tool_result');
    }
    setOpenRequests(requests) {
        this.snapshot.openRequests = requests.map(cloneOpenRequest);
    }
    openRequest(request) {
        this.snapshot.openRequests = this.session.getOpenRequestsForTurn(this.snapshot.id);
        this.snapshot.currentOutputKind = request.kind === 'question' ? 'question' : request.kind === 'tool_approval' ? 'tool_approval' : request.kind;
        this.snapshot.currentMessage = {
            type: this.snapshot.currentOutputKind,
            content: request.kind === 'question' ? request.prompt : request.kind === 'tool_approval' ? request.toolName : request.kind,
            requestId: request.id
        };
        this.snapshot.history.push({
            kind: 'request_opened',
            request: cloneOpenRequest(request),
            message: { ...this.snapshot.currentMessage },
            timestamp: nowIso()
        });
        this.emitUpdate('request_opened');
    }
    closeRequest(request) {
        this.snapshot.openRequests = this.session.getOpenRequestsForTurn(this.snapshot.id);
        this.snapshot.history.push({
            kind: 'request_closed',
            request: cloneOpenRequest(request),
            timestamp: nowIso()
        });
        this.emitUpdate('request_closed');
    }
    addAssistantMessage(message) {
        const content = message.message?.content || message.content || [];
        const textBlocks = content
            .filter((block) => block.type === 'text' && typeof block.text === 'string')
            .map((block) => block.text)
            .join('');
        if (textBlocks) {
            this.snapshot.text = textBlocks;
            this.snapshot.currentOutputKind = 'text';
            this.snapshot.currentMessage = {
                type: 'text',
                content: textBlocks
            };
        }
        this.snapshot.history.push({
            kind: 'assistant_message',
            content: textBlocks,
            message: { ...this.snapshot.currentMessage },
            timestamp: nowIso()
        });
        this.emitUpdate('assistant_message');
    }
    complete(result) {
        this.snapshot.status = result.isError ? 'error' : 'completed';
        this.snapshot.result = { ...result };
        this.snapshot.completedAt = nowIso();
        this.snapshot.currentOutputKind = result.isError ? 'error' : 'complete';
        this.snapshot.currentMessage = {
            type: this.snapshot.currentOutputKind,
            content: result.error || result.result
        };
        this.snapshot.history.push({
            kind: result.isError ? 'error' : 'completed',
            result: { ...result },
            message: { ...this.snapshot.currentMessage },
            timestamp: this.snapshot.completedAt
        });
        this.emitUpdate(result.isError ? 'error' : 'completed');
        this.resolveDone(cloneSnapshot(this.snapshot));
        this.closeIterators();
    }
    fail(error) {
        this.snapshot.status = 'error';
        this.snapshot.completedAt = nowIso();
        this.snapshot.currentOutputKind = 'error';
        this.snapshot.currentMessage = {
            type: 'error',
            content: error.message
        };
        this.snapshot.history.push({
            kind: 'error',
            content: error.message,
            message: { ...this.snapshot.currentMessage },
            timestamp: this.snapshot.completedAt
        });
        this.emitUpdate('error');
        this.rejectDone(error);
        this.closeIterators();
    }
    emitUpdate(kind) {
        const update = {
            kind,
            turnId: this.snapshot.id,
            snapshot: cloneSnapshot(this.snapshot)
        };
        const waiter = this.updateWaiters.shift();
        if (waiter) {
            waiter(update);
        }
        else {
            this.updateQueue.push(update);
        }
        this.emit('update', update);
    }
    closeIterators() {
        while (this.updateWaiters.length > 0) {
            const waiter = this.updateWaiters.shift();
            waiter?.(null);
        }
    }
}
export class StructuredClaudeClient extends EventEmitter {
    rawClient;
    turns = [];
    pendingTurns = [];
    openRequests = new Map();
    activeTurn = null;
    turnCounter = 0;
    constructor(rawClient) {
        super();
        this.rawClient = rawClient;
        this.attachRawEventHandlers();
    }
    static async init(config) {
        const rawClient = new ClaudeClient(config);
        await rawClient.start();
        return new StructuredClaudeClient(rawClient);
    }
    static fromRawClient(rawClient) {
        return new StructuredClaudeClient(rawClient);
    }
    get sessionId() {
        return this.rawClient.sessionId;
    }
    get raw() {
        return this.rawClient;
    }
    send(input, options) {
        const turnId = `turn-${++this.turnCounter}`;
        const handle = new TurnHandle(this, turnId, normalizeSendInput(input), options?.metadata);
        this.turns.push(handle);
        if (this.activeTurn) {
            handle.markQueued();
            this.pendingTurns.push(handle);
        }
        else {
            void this.startTurn(handle);
        }
        return handle;
    }
    getCurrentTurn() {
        return this.activeTurn ? this.activeTurn.current() : null;
    }
    getHistory() {
        return this.turns
            .filter((turn) => {
            const snapshot = turn.current();
            return snapshot.status === 'completed' || snapshot.status === 'error';
        })
            .map((turn) => turn.current());
    }
    getOpenRequests() {
        return Array.from(this.openRequests.values()).map((entry) => cloneOpenRequest(entry.request));
    }
    getOpenRequest(id) {
        const entry = this.openRequests.get(id);
        return entry ? cloneOpenRequest(entry.request) : null;
    }
    createQuestionSession(id) {
        const entry = this.requireOpenRequest(id);
        if (entry.request.kind !== 'question') {
            throw new Error(`Request ${id} is not a question request.`);
        }
        return new ClaudeQuestionSession(this, entry.request);
    }
    async approveRequest(id, decision) {
        const entry = this.requireOpenRequest(id);
        if (entry.request.kind !== 'tool_approval' && entry.request.kind !== 'hook') {
            throw new Error(`Request ${id} cannot be approved with approveRequest.`);
        }
        const responseData = {
            behavior: 'allow',
            message: decision?.message,
            updatedInput: decision?.updatedInput,
            updatedPermissions: decision?.updatedPermissions,
            scope: decision?.scope
        };
        if (entry.request.kind === 'tool_approval') {
            responseData.toolUseID = entry.request.toolUseId;
            if (responseData.updatedInput === undefined) {
                responseData.updatedInput = { ...entry.request.input };
            }
            if (decision?.always && entry.request.suggestions.length > 0 && responseData.updatedPermissions === undefined) {
                responseData.updatedPermissions = entry.request.suggestions.map((suggestion) => ({ ...suggestion }));
                responseData.scope = responseData.scope || 'session';
            }
        }
        else if (entry.request.kind === 'hook' && responseData.updatedInput === undefined) {
            responseData.updatedInput = { ...entry.request.input };
        }
        await this.rawClient.sendControlResponse(entry.sdkRequestId, responseData);
        this.resolveOpenRequest(id, 'resolved');
    }
    async denyRequest(id, reason) {
        const entry = this.requireOpenRequest(id);
        if (entry.request.kind !== 'tool_approval' && entry.request.kind !== 'hook') {
            throw new Error(`Request ${id} cannot be denied with denyRequest.`);
        }
        const responseData = {
            behavior: 'deny',
            message: reason || 'Denied by user.'
        };
        if (entry.request.kind === 'tool_approval') {
            responseData.toolUseID = entry.request.toolUseId;
        }
        await this.rawClient.sendControlResponse(entry.sdkRequestId, responseData);
        this.resolveOpenRequest(id, 'resolved');
    }
    async answerQuestion(id, answers) {
        const entry = this.requireOpenRequest(id);
        if (entry.request.kind !== 'question') {
            throw new Error(`Request ${id} is not a question request.`);
        }
        const updatedInput = buildQuestionUpdatedInput(entry.request, answers);
        await this.rawClient.sendControlResponse(entry.sdkRequestId, {
            behavior: 'allow',
            updatedInput
        });
        this.resolveOpenRequest(id, 'resolved');
    }
    async interruptTurn(_turnId) {
        await this.rawClient.interrupt();
    }
    async setPermissionMode(mode) {
        await this.rawClient.setPermissionMode(mode);
    }
    async setModel(model) {
        await this.rawClient.setModel(model);
    }
    async setMaxThinkingTokens(tokens) {
        await this.rawClient.setMaxThinkingTokens(tokens);
    }
    async listSupportedModels(timeoutMs) {
        return this.rawClient.listSupportedModels(timeoutMs);
    }
    close() {
        this.rawClient.kill();
    }
    getOpenRequestsForTurn(turnId) {
        return Array.from(this.openRequests.values())
            .filter((entry) => entry.request.turnId === turnId && entry.request.status === 'open')
            .map((entry) => cloneOpenRequest(entry.request));
    }
    turnFromRemote(createIfMissing = false) {
        if (this.activeTurn) {
            return this.activeTurn;
        }
        if (!createIfMissing) {
            return null;
        }
        const handle = new TurnHandle(this, `attached-${++this.turnCounter}`, { text: '' }, {
            resumed: true,
            synthetic: true
        });
        this.turns.push(handle);
        this.activeTurn = handle;
        handle.markStarted();
        return handle;
    }
    async startTurn(handle) {
        this.activeTurn = handle;
        handle.markStarted();
        try {
            const input = handle.current().input;
            if (typeof input === 'string') {
                await this.rawClient.sendMessage(input);
            }
            else if ('text' in input) {
                await this.rawClient.sendMessage(input.text);
            }
            else {
                await this.rawClient.sendMessageWithContent(input.content);
            }
        }
        catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            handle.fail(err);
            this.activeTurn = null;
            this.drainPendingTurns();
        }
    }
    drainPendingTurns() {
        if (this.activeTurn || this.pendingTurns.length === 0) {
            return;
        }
        const nextTurn = this.pendingTurns.shift();
        void this.startTurn(nextTurn);
    }
    attachRawEventHandlers() {
        this.rawClient.on('stream_event', (message) => {
            const turn = this.activeTurn;
            if (!turn) {
                return;
            }
            this.handleStreamEvent(turn, message);
        });
        this.rawClient.on('text_accumulated', (text) => {
            this.activeTurn?.updateOutput('text', text);
        });
        this.rawClient.on('thinking_accumulated', (thinking) => {
            this.activeTurn?.updateOutput('thinking', thinking);
        });
        this.rawClient.on('usage_update', (usage) => {
            this.activeTurn?.updateUsage(usage);
        });
        this.rawClient.on('tool_use_start', (tool) => {
            this.handleToolUse(tool);
        });
        this.rawClient.on('tool_result', (toolResult) => {
            this.handleToolResult(toolResult);
        });
        this.rawClient.on('message', (message) => {
            this.activeTurn?.addAssistantMessage(message);
        });
        this.rawClient.on('control_request', (message) => {
            this.handleControlRequest(message);
        });
        this.rawClient.on('control_cancel_request', (message) => {
            this.handleControlCancel(message.request_id);
        });
        this.rawClient.on('result', (message) => {
            const turn = this.activeTurn;
            if (!turn) {
                return;
            }
            turn.setOpenRequests([]);
            for (const [requestId, entry] of this.openRequests.entries()) {
                if (entry.request.turnId === turn.current().id) {
                    this.openRequests.delete(requestId);
                }
            }
            turn.complete({
                subtype: message.subtype,
                isError: message.is_error,
                result: message.result,
                error: message.error,
                durationMs: message.duration_ms,
                durationApiMs: message.duration_api_ms,
                numTurns: message.num_turns
            });
            this.activeTurn = null;
            this.drainPendingTurns();
        });
        this.rawClient.on('error', (error) => {
            if (this.activeTurn) {
                this.activeTurn.fail(error);
                this.activeTurn = null;
            }
            this.drainPendingTurns();
        });
    }
    handleStreamEvent(turn, message) {
        const event = message.event;
        if (event.type === 'message_start') {
            turn.updateStatus('running');
            return;
        }
        if (event.type === 'content_block_start') {
            if (event.content_block?.type === 'thinking') {
                turn.updateOutput('thinking', turn.current().thinking);
            }
            else if (event.content_block?.type === 'text') {
                turn.updateOutput('text', turn.current().text);
            }
            else if (event.content_block?.type === 'tool_use') {
                turn.updateStatus('running');
            }
            return;
        }
        if (event.type === 'message_delta' && event.usage) {
            turn.updateUsage(event.usage);
        }
    }
    handleToolUse(tool) {
        this.activeTurn?.addToolUse({
            id: tool.id,
            name: tool.name,
            input: { ...tool.input },
            startedAt: nowIso()
        });
    }
    handleToolResult(toolResult) {
        this.activeTurn?.addToolResult({
            toolUseId: toolResult.toolUseId,
            content: toolResult.content,
            isError: toolResult.isError,
            receivedAt: nowIso()
        });
    }
    handleControlRequest(message) {
        const turn = this.turnFromRemote(true);
        if (!turn) {
            return;
        }
        const request = message.request;
        const requestId = `${turn.current().id}-request-${this.openRequests.size + 1}`;
        let openRequest = null;
        if (request.subtype === 'can_use_tool') {
            if (request.tool_name === 'AskUserQuestion') {
                const questions = buildQuestionPrompts(request.input);
                openRequest = {
                    id: requestId,
                    kind: 'question',
                    status: 'open',
                    createdAt: nowIso(),
                    turnId: turn.current().id,
                    title: questions[0]?.header,
                    prompt: questions.map((question) => question.prompt).join('\n\n'),
                    questions,
                    allowOther: true,
                    multiSelect: questions.some((question) => question.multiSelect),
                    currentQuestionIndex: 0
                };
            }
            else {
                openRequest = {
                    id: requestId,
                    kind: 'tool_approval',
                    status: 'open',
                    createdAt: nowIso(),
                    turnId: turn.current().id,
                    toolName: request.tool_name || 'unknown',
                    toolUseId: request.tool_use_id,
                    input: { ...(request.input || {}) },
                    suggestions: (request.permission_suggestions || []).map((suggestion) => ({ ...suggestion })),
                    blockedPath: request.blocked_path,
                    decisionReason: request.decision_reason
                };
            }
        }
        else if (request.subtype === 'hook_callback') {
            openRequest = {
                id: requestId,
                kind: 'hook',
                status: 'open',
                createdAt: nowIso(),
                turnId: turn.current().id,
                callbackId: request.callback_id,
                toolUseId: request.tool_use_id,
                input: { ...(request.input || {}) }
            };
        }
        else if (request.subtype === 'mcp_message') {
            openRequest = {
                id: requestId,
                kind: 'mcp',
                status: 'open',
                createdAt: nowIso(),
                turnId: turn.current().id,
                serverName: request.server_name,
                message: request.message
            };
        }
        if (!openRequest) {
            return;
        }
        turn.updateStatus('waiting');
        this.openRequests.set(requestId, {
            sdkRequestId: message.request_id,
            request: openRequest
        });
        turn.setOpenRequests(this.getOpenRequestsForTurn(turn.current().id));
        turn.openRequest(openRequest);
    }
    handleControlCancel(sdkRequestId) {
        for (const [requestId, entry] of this.openRequests.entries()) {
            if (entry.sdkRequestId !== sdkRequestId) {
                continue;
            }
            entry.request.status = 'canceled';
            const turn = this.turns.find((candidate) => candidate.current().id === entry.request.turnId);
            this.openRequests.delete(requestId);
            if (turn) {
                turn.setOpenRequests(this.getOpenRequestsForTurn(entry.request.turnId));
                turn.closeRequest(entry.request);
                if (turn === this.activeTurn) {
                    turn.updateStatus('running');
                }
            }
            break;
        }
    }
    requireOpenRequest(id) {
        const entry = this.openRequests.get(id);
        if (!entry) {
            throw new Error(`Open request ${id} was not found.`);
        }
        return entry;
    }
    resolveOpenRequest(id, status) {
        const entry = this.openRequests.get(id);
        if (!entry) {
            return;
        }
        entry.request.status = status;
        const turn = this.turns.find((candidate) => candidate.current().id === entry.request.turnId);
        this.openRequests.delete(id);
        if (turn) {
            turn.setOpenRequests(this.getOpenRequestsForTurn(entry.request.turnId));
            turn.closeRequest(entry.request);
            if (turn === this.activeTurn) {
                turn.updateStatus('running');
            }
        }
    }
}
function buildQuestionUpdatedInput(request, answers) {
    const normalizedAnswers = normalizeQuestionAnswers(request, answers);
    const answersObject = {};
    request.questions.forEach((question, index) => {
        const key = question.header || question.prompt || `Question ${index + 1}`;
        answersObject[key] = normalizedAnswers[index];
    });
    const questionSummary = request.questions.length === 1
        ? request.questions[0].prompt
        : request.questions.map((question) => question.header || question.prompt).join(', ');
    return {
        question: questionSummary,
        answers: answersObject
    };
}
function normalizeQuestionAnswers(request, answers) {
    if (Array.isArray(answers)) {
        return answers.map((answer) => normalizeQuestionAnswerValue(answer));
    }
    if (typeof answers === 'string') {
        return [answers];
    }
    const mappedAnswers = [];
    for (const question of request.questions) {
        const matchingKey = getQuestionLookupKeys(question).find((key) => answers[key] !== undefined);
        mappedAnswers.push(normalizeQuestionAnswerValue(matchingKey ? answers[matchingKey] : undefined));
    }
    return mappedAnswers;
}
function normalizeQuestionAnswerValue(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (typeof value === 'string') {
        return value;
    }
    return '';
}
