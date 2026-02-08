/**
 * Types for Claude Code SDK Protocol
 */

/**
 * Message types sent from CLI to extension (stdout)
 */


/**
 * System initialization message
 */
export interface SystemMessage {
    type: 'system';
    subtype: 'init';
    session_id: string;
    cwd: string;
    tools: string[];
    mcp_servers: Array<{ name: string; status: string }>;
    model: string;
    permissionMode: string;
    claude_code_version: string;
    uuid?: string;
}

/**
 * Stream event (real-time updates)
 */
export interface StreamEventMessage {
    type: 'stream_event';
    event: StreamEvent;
    session_id: string;
    parent_tool_use_id: string | null;
    uuid: string;
}

export type StreamEvent =
    | { type: 'message_start'; message: any }
    | { type: 'content_block_start'; index: number; content_block: any }
    | { type: 'content_block_delta'; index: number; delta: ContentDelta }
    | { type: 'content_block_stop'; index: number }
    | { type: 'message_delta'; delta: any; usage: Usage }
    | { type: 'message_stop' };

export interface ContentDelta {
    type: 'text_delta' | 'input_json_delta' | 'thinking_delta';
    text?: string;
    partial_json?: string;
    thinking?: string;
}

export interface Usage {
    input_tokens: number;
    output_tokens: number;
}

/**
 * Complete assistant message
 */
export interface AssistantMessage {
    type: 'assistant';
    message: {
        id: string;
        role: 'assistant';
        content: ContentBlock[];
        stop_reason: string | null;
        usage: Usage;
    };
    id: string; // Legacy/Duplicate?
    content: ContentBlock[]; // Legacy/Duplicate?
    
    // Legacy fields that might still be present
    todos?: Array<{
        id: string;
        content: string;
        status: 'pending' | 'in_progress' | 'completed';
    }>;
    thinkingMetadata?: {
        token_limit: number;
        token_count: number;
    };
}

export type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
    | { type: 'thinking'; thinking: string; signature?: string };

/**
 * User message (including tool results)
 */
export interface UserMessage {
    type: 'user';
    message: {
        role: 'user';
        content: Array<{ type: 'tool_result'; content: string; is_error?: boolean; tool_use_id: string }>;
    };
    // Flattened fields sometimes seen
    role: 'user';
    content: Array<{ type: 'tool_result'; content: string; is_error?: boolean; tool_use_id: string }>;
}

/**
 * Control request (permission, question, etc.)
 */
export interface ControlRequestMessage {
    type: 'control_request';
    request_id: string;
    request: ControlRequest;
}

export type ControlRequest =
    | CanUseToolRequest
    | HookCallbackRequest
    | McpMessageRequest
    | SetPermissionModeRequest
    | SetModelRequest
    | SetMaxThinkingTokensRequest
    | InterruptRequest;

export interface CanUseToolRequest {
    subtype: 'can_use_tool';
    tool_name?: string;
    input?: Record<string, any>;
    permission_suggestions?: Suggestion[];
    blocked_path?: string;
    decision_reason?: string;
    tool_use_id?: string;
    agent_id?: string;
}

export interface HookCallbackRequest {
    subtype: 'hook_callback';
    callback_id?: string;
    input?: Record<string, any>;
    tool_use_id?: string;
}

export interface McpMessageRequest {
    subtype: 'mcp_message';
    server_name: string;
    message: any;
}

export interface SetPermissionModeRequest {
    subtype: 'set_permission_mode';
    mode: 'default' | 'acceptEdits';
}

export interface SetModelRequest {
    subtype: 'set_model';
    model: string;
}

export interface SetMaxThinkingTokensRequest {
    subtype: 'set_max_thinking_tokens';
    max_thinking_tokens: number;
}

export interface InterruptRequest {
    subtype: 'interrupt';
}

export interface Suggestion {
    type: 'allow' | 'deny' | 'allow_always' | 'deny_always';
    scope?: PermissionScope;
    description: string;
}

export type PermissionScope = 'session' | 'directory' | 'global';

/**
 * Control response (our reply to control request)
 */
export interface ControlResponseMessage {
    type: 'control_response';
    subtype: 'success' | 'error';
    request_id: string;
    response?: ControlResponseData;
    error?: string;
    pending_permission_requests?: ControlRequest[];
}

// Control response envelope received from CLI (stdout)
export interface ControlResponseEnvelope {
    type: 'control_response';
    response: {
        subtype: 'success' | 'error';
        request_id: string;
        response?: ControlResponseData;
        error?: string;
        pending_permission_requests?: ControlRequest[];
    };
}

export interface ControlResponseData {
    behavior: 'allow' | 'deny';
    message?: string;
    toolUseID?: string;
    updatedInput?: Record<string, any>;
    updatedPermissions?: any[];
    scope?: PermissionScope;
}

/**
 * Keep-alive message
 */
export interface KeepAliveMessage {
    type: 'keep_alive';
}

/**
 * Control cancel request (cancel pending control request)
 */
export interface ControlCancelRequestMessage {
    type: 'control_cancel_request';
    request_id: string;
}

export interface McpMessageEvent {
    serverName: string;
    message: any;
    requestId: string;
    respond: (mcpResponse: any) => Promise<void>;
}

export interface HookCallbackEvent {
    callbackId?: string;
    input?: Record<string, any>;
    toolUseId?: string;
    requestId: string;
    respond: (responseData: ControlResponseData) => Promise<void>;
}

/**
 * Message types sent from extension to CLI (stdin)
 */
export interface InputMessage {
    type: 'user' | 'control_response' | 'control_request' | 'interrupt';
}

export interface UserInputMessage {
    type: 'user';
    session_id: string;
    message: {
        role: 'user';
        content: [{ type: 'text'; text: string }];
    };
}

export interface ProtocolError {
    type: 'error';
    error: {
        type: string;
        message: string;
    };
}
export interface ResultMessage {
    type: 'result';
    subtype: 'success' | 'error';
    is_error: boolean;
    duration_ms: number;
    duration_api_ms: number;
    num_turns: number;
    result: string;
    error?: string;
}

export type CliMessage =
    | SystemMessage
    | StreamEventMessage
    | AssistantMessage
    | UserMessage
    | ControlRequestMessage
    | ControlResponseMessage
    | ControlResponseEnvelope
    | ControlCancelRequestMessage
    | KeepAliveMessage
    | ResultMessage;
