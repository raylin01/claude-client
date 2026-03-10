import { EventEmitter } from 'events';
import { ClaudeClient, ClaudeClientConfig } from './client.js';
import { AssistantMessage, PermissionScope, Suggestion, Usage } from './types.js';
export type OutputKind = 'idle' | 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'tool_approval' | 'question' | 'hook' | 'mcp' | 'complete' | 'error';
export type TurnStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'error';
export interface ClaudeSendContentBlock {
    type: string;
    [key: string]: any;
}
export type ClaudeSendInput = string | {
    text: string;
} | {
    content: ClaudeSendContentBlock[];
};
export interface ClaudeSendOptions {
    metadata?: Record<string, unknown>;
}
export interface TurnMessageState {
    type: OutputKind;
    content: string;
    toolName?: string;
    toolUseId?: string;
    requestId?: string;
}
export interface ToolUseState {
    id: string;
    name: string;
    input: Record<string, any>;
    startedAt: string;
}
export interface ToolResultState {
    toolUseId: string;
    content: string;
    isError: boolean;
    receivedAt: string;
}
export interface QuestionOption {
    label: string;
    value: string;
    description?: string;
}
export interface QuestionPrompt {
    id: string;
    header?: string;
    prompt: string;
    options: QuestionOption[];
    multiSelect: boolean;
}
interface BaseOpenRequest {
    id: string;
    kind: 'tool_approval' | 'question' | 'hook' | 'mcp';
    status: 'open' | 'resolved' | 'canceled';
    createdAt: string;
    turnId: string;
}
export interface ToolApprovalRequest extends BaseOpenRequest {
    kind: 'tool_approval';
    toolName: string;
    toolUseId?: string;
    input: Record<string, any>;
    suggestions: Suggestion[];
    blockedPath?: string;
    decisionReason?: string;
}
export interface QuestionRequest extends BaseOpenRequest {
    kind: 'question';
    title?: string;
    prompt: string;
    questions: QuestionPrompt[];
    allowOther: boolean;
    multiSelect: boolean;
    currentQuestionIndex: number;
}
export interface HookRequest extends BaseOpenRequest {
    kind: 'hook';
    callbackId?: string;
    toolUseId?: string;
    input: Record<string, any>;
}
export interface McpRequest extends BaseOpenRequest {
    kind: 'mcp';
    serverName: string;
    message: any;
}
export type OpenRequest = ToolApprovalRequest | QuestionRequest | HookRequest | McpRequest;
export interface TurnHistoryEntry {
    kind: 'status' | 'output' | 'tool_use' | 'tool_result' | 'request_opened' | 'request_closed' | 'assistant_message' | 'completed' | 'error';
    timestamp: string;
    outputKind?: OutputKind;
    content?: string;
    toolUse?: ToolUseState;
    toolResult?: ToolResultState;
    request?: OpenRequest;
    status?: TurnStatus;
    message?: TurnMessageState;
    result?: TurnResult;
}
export interface TurnResult {
    subtype: 'success' | 'error';
    isError: boolean;
    result: string;
    error?: string;
    durationMs: number;
    durationApiMs: number;
    numTurns: number;
}
export interface TurnSnapshot {
    id: string;
    input: ClaudeSendInput;
    status: TurnStatus;
    currentOutputKind: OutputKind;
    currentMessage: TurnMessageState;
    text: string;
    thinking: string;
    toolUses: ToolUseState[];
    toolResults: ToolResultState[];
    openRequests: OpenRequest[];
    history: TurnHistoryEntry[];
    usage?: Usage;
    startedAt: string;
    completedAt?: string;
    result?: TurnResult;
    metadata?: Record<string, unknown>;
}
export interface TurnUpdate {
    turnId: string;
    snapshot: TurnSnapshot;
    kind: 'queued' | 'started' | 'output' | 'tool_use' | 'tool_result' | 'request_opened' | 'request_closed' | 'assistant_message' | 'completed' | 'error';
}
export type QuestionAnswerValue = string | string[];
export type QuestionAnswerInput = QuestionAnswerValue | QuestionAnswerValue[] | Record<string, QuestionAnswerValue>;
export interface ClaudeQuestionSessionSnapshot {
    requestId: string;
    request: QuestionRequest;
    currentIndex: number;
    answers: Record<string, QuestionAnswerValue>;
}
export declare class ClaudeQuestionSession {
    private readonly client;
    private readonly request;
    private readonly answers;
    private currentIndex;
    constructor(client: StructuredClaudeClient, request: QuestionRequest);
    get requestId(): string;
    current(): ClaudeQuestionSessionSnapshot;
    getCurrentQuestion(): QuestionPrompt | null;
    getAnswers(): Record<string, QuestionAnswerValue>;
    setAnswer(questionKey: string | number, answer: QuestionAnswerValue): this;
    setCurrentAnswer(answer: QuestionAnswerValue): this;
    next(): QuestionPrompt | null;
    previous(): QuestionPrompt | null;
    submit(): Promise<void>;
}
declare class TurnHandle extends EventEmitter {
    private readonly session;
    private snapshot;
    private updateQueue;
    private updateWaiters;
    readonly done: Promise<TurnSnapshot>;
    private resolveDone;
    private rejectDone;
    constructor(session: StructuredClaudeClient, id: string, input: ClaudeSendInput, metadata?: Record<string, unknown>);
    current(): TurnSnapshot;
    history(): TurnHistoryEntry[];
    getOpenRequests(): OpenRequest[];
    onUpdate(listener: (update: TurnUpdate) => void): this;
    updates(): AsyncIterableIterator<TurnUpdate>;
    markQueued(): void;
    markStarted(): void;
    updateStatus(status: TurnStatus): void;
    updateOutput(kind: OutputKind, content: string): void;
    updateUsage(usage: Usage): void;
    addToolUse(tool: ToolUseState): void;
    addToolResult(toolResult: ToolResultState): void;
    setOpenRequests(requests: OpenRequest[]): void;
    openRequest(request: OpenRequest): void;
    closeRequest(request: OpenRequest): void;
    addAssistantMessage(message: AssistantMessage): void;
    complete(result: TurnResult): void;
    fail(error: Error): void;
    private emitUpdate;
    private closeIterators;
}
export declare class StructuredClaudeClient extends EventEmitter {
    private readonly rawClient;
    private readonly turns;
    private readonly pendingTurns;
    private readonly openRequests;
    private activeTurn;
    private turnCounter;
    constructor(rawClient: ClaudeClient);
    static init(config: ClaudeClientConfig): Promise<StructuredClaudeClient>;
    static fromRawClient(rawClient: ClaudeClient): StructuredClaudeClient;
    get sessionId(): string | null;
    get raw(): ClaudeClient;
    send(input: ClaudeSendInput, options?: ClaudeSendOptions): TurnHandle;
    getCurrentTurn(): TurnSnapshot | null;
    getHistory(): TurnSnapshot[];
    getOpenRequests(): OpenRequest[];
    getOpenRequest(id: string): OpenRequest | null;
    createQuestionSession(id: string): ClaudeQuestionSession;
    approveRequest(id: string, decision?: {
        message?: string;
        updatedInput?: Record<string, any>;
        updatedPermissions?: any[];
        scope?: PermissionScope;
        always?: boolean;
    }): Promise<void>;
    denyRequest(id: string, reason?: string): Promise<void>;
    answerQuestion(id: string, answers: QuestionAnswerInput): Promise<void>;
    interruptTurn(_turnId?: string): Promise<void>;
    setPermissionMode(mode: 'acceptEdits' | 'bypassPermissions' | 'default' | 'dontAsk' | 'plan'): Promise<void>;
    setModel(model: string): Promise<void>;
    setMaxThinkingTokens(tokens: number): Promise<void>;
    listSupportedModels(timeoutMs?: number): Promise<import("./types.js").ClaudeSupportedModelsResponse>;
    close(): void;
    getOpenRequestsForTurn(turnId: string): OpenRequest[];
    private turnFromRemote;
    private startTurn;
    private drainPendingTurns;
    private attachRawEventHandlers;
    private handleStreamEvent;
    private handleToolUse;
    private handleToolResult;
    private handleControlRequest;
    private handleControlCancel;
    private requireOpenRequest;
    private resolveOpenRequest;
}
export {};
