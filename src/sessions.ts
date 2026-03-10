/**
 * Session Discovery & Management
 * 
 * Utilities for reading Claude Code session data from ~/.claude/projects/
 */

import { readFileSync, readdirSync, existsSync, statSync, watch, FSWatcher } from 'fs';
import { readFile, readdir, stat } from 'fs/promises';
import { join, basename, isAbsolute } from 'path';
import { homedir } from 'os';
import { EventEmitter } from 'events';
import type {
    ClaudeSessionLocatorOptions,
    SessionBrowserRecord,
    SessionBrowserSummary,
    SessionTranscriptContentBlock,
    SessionTranscriptMessage
} from './types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Project information from ~/.claude/projects/
 */
export interface ProjectInfo {
    /** Original project path (e.g., /Users/ray/Documents/DisCode) */
    path: string;
    /** Escaped path used as directory name (e.g., -Users-ray-Documents-DisCode) */
    escapedPath: string;
    /** Full path to session storage directory */
    storagePath: string;
    /** Number of sessions in this project */
    sessionCount: number;
    /** Last modified timestamp */
    lastModified: Date;
}

/**
 * Session entry from sessions-index.json
 */
export interface SessionEntry {
    sessionId: string;
    fullPath: string;
    fileMtime: number;
    firstPrompt: string;
    messageCount: number;
    created: string;
    modified: string;
    gitBranch?: string;
    projectPath: string;
    isSidechain: boolean;
}

/**
 * Sessions index file structure
 */
interface SessionsIndex {
    version: number;
    entries: SessionEntry[];
}

/**
 * Individual session message from JSONL file
 */
export interface SessionMessage {
    type: 'summary' | 'user' | 'assistant' | 'file-history-snapshot';
    uuid?: string;
    parentUuid?: string;
    timestamp?: string;
    sessionId?: string;
    message?: {
        role: 'user' | 'assistant';
        content: any;
    };
    summary?: string;
    cwd?: string;
    version?: string;
    gitBranch?: string;
}

/**
 * Parsed session details
 */
export interface SessionDetails {
    sessionId: string;
    projectPath: string;
    summary?: string;
    messages: SessionMessage[];
    created?: Date;
    modified?: Date;
    gitBranch?: string;
    messageCount: number;
}

// ============================================================================
// Session Discovery Service
// ============================================================================

function getClaudeDir(options: ClaudeSessionLocatorOptions = {}): string {
    if (options.claudeDir) return options.claudeDir;
    return join(options.homeDir || homedir(), '.claude');
}

function getProjectsDir(options: ClaudeSessionLocatorOptions = {}): string {
    return join(getClaudeDir(options), 'projects');
}

/**
 * Convert project path to escaped directory name
 */
export function escapeProjectPath(projectPath: string): string {
    // Match Claude Code extension encoding: replace any non-alphanumeric with '-'
    // This is lossy but ensures we hit the correct storage folder name.
    return projectPath.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Convert escaped directory name back to project path
 */
export function unescapeProjectPath(escapedPath: string): string {
    // Legacy fallback only. This is lossy because the extension encoding is lossy.
    // Prefer reading projectPath from sessions-index.json when available.
    return escapedPath.replace(/-/g, '/');
}

function deriveProjectPath(storagePath: string, escapedPath: string): string {
    const indexPath = join(storagePath, 'sessions-index.json');
    if (existsSync(indexPath)) {
        try {
            const index = JSON.parse(readFileSync(indexPath, 'utf-8')) as SessionsIndex;
            const entryPath = index.entries?.find(e => typeof e.projectPath === 'string')?.projectPath;
            if (entryPath && isAbsolute(entryPath)) {
                return entryPath;
            }
        } catch {
            // Fall back to legacy unescape
        }
    }
    return unescapeProjectPath(escapedPath);
}

/**
 * Get the storage path for a project
 */
export function getProjectStoragePath(projectPath: string, options: ClaudeSessionLocatorOptions = {}): string {
    return join(getProjectsDir(options), escapeProjectPath(projectPath));
}

/**
 * List all projects known to Claude Code
 */
export function listProjects(options: ClaudeSessionLocatorOptions = {}): ProjectInfo[] {
    const projectsDir = getProjectsDir(options);
    if (!existsSync(projectsDir)) {
        return [];
    }

    const projects: ProjectInfo[] = [];
    
    try {
        const dirs = readdirSync(projectsDir, { withFileTypes: true });
        
        for (const dir of dirs) {
            if (!dir.isDirectory()) continue;
            if (dir.name === '.' || dir.name === '..') continue;
            
            const storagePath = join(projectsDir, dir.name);
            const projectPath = deriveProjectPath(storagePath, dir.name);
            
            // Get session count
            let sessionCount = 0;
            const indexPath = join(storagePath, 'sessions-index.json');
            if (existsSync(indexPath)) {
                try {
                    const index = JSON.parse(readFileSync(indexPath, 'utf-8')) as SessionsIndex;
                    sessionCount = index.entries?.length || 0;
                } catch (e) {
                    // Count JSONL files as fallback
                    const files = readdirSync(storagePath);
                    sessionCount = files.filter(f => f.endsWith('.jsonl')).length;
                }
            }
            
            // Get last modified
            const stat = statSync(storagePath);
            
            projects.push({
                path: projectPath,
                escapedPath: dir.name,
                storagePath,
                sessionCount,
                lastModified: stat.mtime
            });
        }
    } catch (e) {
        console.error('Error reading projects directory:', e);
    }
    
    return projects.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}

/**
 * Async version of listProjects to avoid blocking the event loop
 */
export async function listProjectsAsync(options: ClaudeSessionLocatorOptions = {}): Promise<ProjectInfo[]> {
    const projectsDir = getProjectsDir(options);
    if (!existsSync(projectsDir)) {
        return [];
    }

    const projects: ProjectInfo[] = [];

    try {
        const dirs = await readdir(projectsDir, { withFileTypes: true });

        for (const dir of dirs) {
            if (!dir.isDirectory()) continue;
            if (dir.name === '.' || dir.name === '..') continue;

            const storagePath = join(projectsDir, dir.name);
            const projectPath = deriveProjectPath(storagePath, dir.name);

            let sessionCount = 0;
            const indexPath = join(storagePath, 'sessions-index.json');
            if (existsSync(indexPath)) {
                try {
                    const index = JSON.parse(await readFile(indexPath, 'utf-8')) as SessionsIndex;
                    sessionCount = index.entries?.length || 0;
                } catch {
                    const files = await readdir(storagePath);
                    sessionCount = files.filter(f => f.endsWith('.jsonl')).length;
                }
            }

            const statInfo = await stat(storagePath);

            projects.push({
                path: projectPath,
                escapedPath: dir.name,
                storagePath,
                sessionCount,
                lastModified: statInfo.mtime
            });
        }
    } catch (e) {
        console.error('Error reading projects directory:', e);
    }

    return projects.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}

/**
 * List sessions for a specific project
 */
export async function listSessions(projectPath: string, options: ClaudeSessionLocatorOptions = {}): Promise<SessionEntry[]> {
    const storagePath = getProjectStoragePath(projectPath, options);
    const indexPath = join(storagePath, 'sessions-index.json');

    if (!existsSync(indexPath)) {
        return [];
    }
    
    try {
        const { readFile } = await import('fs/promises');
        const content = await readFile(indexPath, 'utf-8');
        const index = JSON.parse(content) as SessionsIndex;
        return (index.entries || []).sort((a, b) => 
            new Date(b.modified).getTime() - new Date(a.modified).getTime()
        );
    } catch {
        return [];
    }
}

/**
 * Get detailed information about a session
 */
export function getSessionDetails(sessionId: string, projectPath: string, options: ClaudeSessionLocatorOptions = {}): SessionDetails | null {
    const storagePath = getProjectStoragePath(projectPath, options);
    const sessionPath = join(storagePath, `${sessionId}.jsonl`);
    
    if (!existsSync(sessionPath)) {
        return null;
    }
    
    try {
        const content = readFileSync(sessionPath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());
        const messages: SessionMessage[] = [];
        let summary: string | undefined;
        let gitBranch: string | undefined;
        let created: Date | undefined;
        let modified: Date | undefined;
        
        for (const line of lines) {
            try {
                const msg = JSON.parse(line) as SessionMessage;
                messages.push(msg);
                
                if (msg.type === 'summary' && msg.summary) {
                    summary = msg.summary;
                }
                if (msg.gitBranch) {
                    gitBranch = msg.gitBranch;
                }
                if (msg.timestamp) {
                    const ts = new Date(msg.timestamp);
                    if (!created || ts < created) created = ts;
                    if (!modified || ts > modified) modified = ts;
                }
            } catch (e) {
                // Skip invalid lines
            }
        }
        
        return {
            sessionId,
            projectPath,
            summary,
            messages,
            created,
            modified,
            gitBranch,
            messageCount: messages.filter(m => m.type === 'user' || m.type === 'assistant').length
        };
    } catch (e) {
        console.error('Error reading session details:', e);
        return null;
    }
}

/**
 * Async version of getSessionDetails to avoid blocking the event loop
 */
export async function getSessionDetailsAsync(sessionId: string, projectPath: string, options: ClaudeSessionLocatorOptions = {}): Promise<SessionDetails | null> {
    const storagePath = getProjectStoragePath(projectPath, options);
    const sessionPath = join(storagePath, `${sessionId}.jsonl`);

    if (!existsSync(sessionPath)) {
        return null;
    }

    try {
        const content = await readFile(sessionPath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());
        const messages: SessionMessage[] = [];
        let summary: string | undefined;
        let gitBranch: string | undefined;
        let created: Date | undefined;
        let modified: Date | undefined;

        for (const line of lines) {
            try {
                const msg = JSON.parse(line) as SessionMessage;
                messages.push(msg);

                if (msg.type === 'summary' && msg.summary) {
                    summary = msg.summary;
                }
                if (msg.gitBranch) {
                    gitBranch = msg.gitBranch;
                }
                if (msg.timestamp) {
                    const ts = new Date(msg.timestamp);
                    if (!created || ts < created) created = ts;
                    if (!modified || ts > modified) modified = ts;
                }
            } catch {
                // Skip invalid lines
            }
        }

        return {
            sessionId,
            projectPath,
            summary,
            messages,
            created,
            modified,
            gitBranch,
            messageCount: messages.filter(m => m.type === 'user' || m.type === 'assistant').length
        };
    } catch (e) {
        console.error('Error reading session details:', e);
        return null;
    }
}

/**
 * Get messages from a session since a given timestamp
 */
export function getMessagesSince(sessionId: string, projectPath: string, since: Date, options: ClaudeSessionLocatorOptions = {}): SessionMessage[] {
    const details = getSessionDetails(sessionId, projectPath, options);
    if (!details) return [];
    
    return details.messages.filter(msg => {
        if (!msg.timestamp) return false;
        return new Date(msg.timestamp) > since;
    });
}

function toIsoTimestamp(value: unknown): string {
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    }
    if (typeof value === 'number') {
        const ms = value > 1_000_000_000_000 ? value : value * 1000;
        return new Date(ms).toISOString();
    }
    return new Date().toISOString();
}

function safeJson(value: unknown, maxChars = 1200): string {
    try {
        const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        return raw.length > maxChars ? `${raw.slice(0, maxChars)}...` : raw;
    } catch {
        return String(value);
    }
}

function buildTranscriptMessage(
    role: 'user' | 'assistant',
    createdAt: string,
    turnId: string,
    itemId: string,
    blockIndex: number,
    block: SessionTranscriptContentBlock
): SessionTranscriptMessage {
    return {
        id: `${turnId}:${itemId}:${blockIndex}`,
        role,
        createdAt,
        turnId,
        itemId,
        content: [block]
    };
}

function extractClaudeTextBlock(block: any): string | null {
    if (!block) return null;
    if (typeof block?.text === 'string' && block.text.trim()) return block.text.trim();
    if (typeof block?.content === 'string' && block.content.trim()) return block.content.trim();
    return null;
}

function formatClaudeTodos(todos: any[]): string | null {
    if (!Array.isArray(todos) || todos.length === 0) return null;
    const lines = todos.slice(0, 20).map((todo: any) => {
        const status = typeof todo?.status === 'string' ? todo.status : 'pending';
        const content = typeof todo?.content === 'string'
            ? todo.content
            : (typeof todo?.title === 'string' ? todo.title : 'Untitled');
        return `- [${status}] ${content}`;
    });
    if (todos.length > 20) {
        lines.push(`- ...and ${todos.length - 20} more`);
    }
    return lines.join('\n').trim() || null;
}

function extractFirstPrompt(messages: SessionMessage[]): string {
    for (const message of messages) {
        const content = Array.isArray(message?.message?.content) ? message.message.content : [];
        for (const block of content) {
            const text = extractClaudeTextBlock(block);
            if (text) return text;
        }
        if (typeof message?.summary === 'string' && message.summary.trim()) {
            return message.summary.trim();
        }
    }
    return 'Claude session';
}

export function normalizeClaudeSessionMessages(rawMessages: SessionMessage[]): SessionTranscriptMessage[] {
    const messages: SessionTranscriptMessage[] = [];
    const resolvedToolUseIds = new Set<string>();
    const pendingToolUses = new Map<string, {
        turnId: string;
        itemId: string;
        createdAt: string;
        toolName?: string;
        input?: unknown;
        messageIndex: number;
    }>();

    for (const raw of rawMessages) {
        const content = Array.isArray(raw?.message?.content) ? raw.message.content : [];
        for (const block of content) {
            if (block?.type === 'tool_result' && typeof block?.tool_use_id === 'string' && block.tool_use_id.trim()) {
                resolvedToolUseIds.add(block.tool_use_id);
            }
        }
    }

    rawMessages.forEach((raw, index) => {
        const rawType = String(raw?.type || '');
        if (
            rawType === 'queue-operation' ||
            rawType === 'file-history-snapshot' ||
            (raw as any)?.isSnapshotUpdate ||
            (raw as any)?.snapshot
        ) {
            return;
        }

        const role: 'user' | 'assistant' = raw?.message?.role === 'user' || rawType === 'user' ? 'user' : 'assistant';
        const createdAt = toIsoTimestamp(raw?.timestamp ?? Date.now());
        const turnId = `claude-${raw?.sessionId || 'session'}`;
        const itemId = typeof raw?.uuid === 'string' && raw.uuid.trim() ? raw.uuid : `line-${index}`;
        const blocks: SessionTranscriptContentBlock[] = [];

        if (rawType === 'summary' && typeof raw?.summary === 'string' && raw.summary.trim()) {
            blocks.push({ type: 'text', text: raw.summary.trim() });
        }

        const content = Array.isArray(raw?.message?.content) ? raw.message.content : [];
        for (const block of content) {
            const blockType = typeof block?.type === 'string' ? block.type : 'unknown';
            if (blockType === 'text' || blockType === 'input_text' || blockType === 'output_text' || blockType === 'inputText') {
                const text = extractClaudeTextBlock(block);
                if (text) blocks.push({ type: 'text', text });
                continue;
            }
            if (blockType === 'thinking' && typeof block?.thinking === 'string' && block.thinking.trim()) {
                blocks.push({ type: 'thinking', thinking: block.thinking.trim() });
                continue;
            }
            if (blockType === 'tool_use') {
                const toolUseId = typeof block?.id === 'string' && block.id.trim() ? block.id : undefined;
                const toolName = typeof block?.name === 'string' && block.name.trim() ? block.name : 'ToolUse';
                blocks.push({
                    type: 'tool_use',
                    name: toolName,
                    input: block?.input,
                    toolUseId
                });
                if (toolUseId && !resolvedToolUseIds.has(toolUseId)) {
                    pendingToolUses.set(toolUseId, {
                        turnId,
                        itemId,
                        createdAt,
                        toolName,
                        input: block?.input,
                        messageIndex: index
                    });
                }
                continue;
            }
            if (blockType === 'tool_result') {
                const toolUseId = typeof block?.tool_use_id === 'string' && block.tool_use_id.trim()
                    ? block.tool_use_id
                    : undefined;
                blocks.push({
                    type: 'tool_result',
                    content: block?.content,
                    isError: Boolean(block?.is_error),
                    toolUseId
                });
                if (toolUseId) resolvedToolUseIds.add(toolUseId);
                continue;
            }
            const fallback = safeJson(block, 900).trim();
            if (fallback) {
                blocks.push({ type: 'text', text: `[${blockType}] ${fallback}` });
            }
        }

        const todosText = formatClaudeTodos((raw as any)?.todos);
        if (todosText) {
            blocks.push({
                type: 'plan',
                text: 'Todo List',
                explanation: todosText
            });
        }

        if (blocks.length === 0 && (raw as any)?.toolUseResult != null) {
            const toolResultText = typeof (raw as any).toolUseResult === 'string'
                ? (raw as any).toolUseResult
                : safeJson((raw as any).toolUseResult, 1200);
            if (toolResultText.trim()) {
                blocks.push({
                    type: 'tool_result',
                    content: toolResultText,
                    isError: toolResultText.toLowerCase().includes('error')
                });
            }
        }

        blocks.forEach((block, blockIndex) => {
            messages.push(buildTranscriptMessage(role, createdAt, turnId, itemId, blockIndex, block));
        });
    });

    const nearTailIndex = Math.max(0, rawMessages.length - 3);
    for (const [toolUseId, pending] of pendingToolUses) {
        if (resolvedToolUseIds.has(toolUseId)) continue;
        if (pending.messageIndex < nearTailIndex) continue;
        messages.push(buildTranscriptMessage(
            'assistant',
            pending.createdAt,
            pending.turnId,
            `${pending.itemId}-approval`,
            0,
            {
                type: 'approval_needed',
                title: 'Tool approval may be required',
                description: 'This tool use appears unresolved in the saved Claude session.',
                toolName: pending.toolName,
                status: 'pending',
                requiresAttach: true,
                payload: {
                    toolUseId,
                    input: pending.input
                }
            }
        ));
    }

    return messages;
}

export async function listClaudeSessionSummaries(
    projectPath: string,
    options: ClaudeSessionLocatorOptions = {}
): Promise<SessionBrowserSummary<SessionEntry>[]> {
    const entries = await listSessions(projectPath, options);
    return entries.map((entry) => ({
        provider: 'claude',
        sessionId: entry.sessionId,
        title: entry.firstPrompt || 'Claude session',
        createdAt: toIsoTimestamp(entry.created),
        updatedAt: toIsoTimestamp(entry.modified),
        messageCount: entry.messageCount,
        projectPath: entry.projectPath,
        gitBranch: entry.gitBranch,
        raw: entry
    }));
}

export async function readClaudeSessionRecord(
    sessionId: string,
    projectPath: string,
    options: ClaudeSessionLocatorOptions = {}
): Promise<SessionBrowserRecord<SessionDetails, SessionMessage> | null> {
    const details = await getSessionDetailsAsync(sessionId, projectPath, options);
    if (!details) return null;
    return {
        provider: 'claude',
        sessionId: details.sessionId,
        title: details.summary || extractFirstPrompt(details.messages),
        createdAt: details.created?.toISOString(),
        updatedAt: details.modified?.toISOString(),
        messageCount: details.messageCount,
        projectPath: details.projectPath,
        gitBranch: details.gitBranch,
        raw: details,
        rawMessages: details.messages,
        messages: normalizeClaudeSessionMessages(details.messages)
    };
}

// ============================================================================
// Session Watcher
// ============================================================================

export interface WatcherEvents {
    'session_updated': (entry: SessionEntry) => void;
    'session_new': (entry: SessionEntry) => void;
    'project_updated': (projectPath: string) => void;
    'error': (error: Error) => void;
}

export declare interface SessionWatcher {
    on<K extends keyof WatcherEvents>(event: K, listener: WatcherEvents[K]): this;
    emit<K extends keyof WatcherEvents>(event: K, ...args: Parameters<WatcherEvents[K]>): boolean;
}

/**
 * Watch for session changes with adaptive polling
 */
export class SessionWatcher extends EventEmitter {
    private watchers = new Map<string, FSWatcher>();
    private pollTimers = new Map<string, NodeJS.Timeout>();
    private lastKnownState = new Map<string, Map<string, number>>(); // projectPath -> sessionId -> mtime
    private ownedSessions = new Set<string>(); // Sessions we control (don't watch)
    
    private pollIntervals = {
        active: 2000,    // 2s when active
        recent: 10000,   // 10s when recent activity
        idle: 60000      // 60s when idle
    };
    
    private activityTimestamps = new Map<string, number>(); // projectPath -> last activity
    
    /**
     * Mark a session as owned by this client (don't watch for external changes)
     */
    markAsOwned(sessionId: string): void {
        this.ownedSessions.add(sessionId);
    }
    
    /**
     * Unmark a session as owned
     */
    unmarkAsOwned(sessionId: string): void {
        this.ownedSessions.delete(sessionId);
    }
    
    /**
     * Record activity for a project (affects polling interval)
     */
    recordActivity(projectPath: string): void {
        this.activityTimestamps.set(projectPath, Date.now());
    }
    
    /**
     * Get current poll interval for a project
     */
    private getPollInterval(projectPath: string): number {
        const lastActivity = this.activityTimestamps.get(projectPath) || 0;
        const elapsed = Date.now() - lastActivity;
        
        if (elapsed < 30000) return this.pollIntervals.active;  // < 30s
        if (elapsed < 300000) return this.pollIntervals.recent; // < 5min
        return this.pollIntervals.idle;
    }
    
    /**
     * Start watching a project
     */
    watchProject(projectPath: string): void {
        const storagePath = getProjectStoragePath(projectPath);
        
        if (!existsSync(storagePath)) {
            console.warn(`Project storage not found: ${storagePath}`);
            return;
        }
        
        // Initialize state
        this.updateKnownState(projectPath).catch(err => {
            const msg = `Error initializing state for ${projectPath}`;
            this.emit('error', err instanceof Error ? err : new Error(msg));
        });
        
        // Try to use fs.watch first
        try {
            const watcher = watch(storagePath, { persistent: false }, (eventType, filename) => {
                if (filename === 'sessions-index.json' || filename?.endsWith('.jsonl')) {
                    this.recordActivity(projectPath);
                    this.checkForChanges(projectPath).catch(err => {
                        const msg = `Error checking for changes in ${projectPath}`;
                        this.emit('error', err instanceof Error ? err : new Error(msg));
                    });
                }
            });
            
            watcher.on('error', (error) => {
                console.warn(`File watcher error for ${projectPath}, falling back to polling:`, error);
                watcher.close();
                this.watchers.delete(projectPath);
                this.startPolling(projectPath);
            });
            
            this.watchers.set(projectPath, watcher);
        } catch (e) {
            // Fall back to polling
            this.startPolling(projectPath);
        }
    }
    
    /**
     * Start polling for a project
     */
    private startPolling(projectPath: string): void {
        const poll = () => {
            this.checkForChanges(projectPath).catch(err => {
                const msg = `Polling error for ${projectPath}`;
                this.emit('error', err instanceof Error ? err : new Error(msg));
            });
            
            // Schedule next poll with adaptive interval
            const interval = this.getPollInterval(projectPath);
            const timer = setTimeout(poll, interval);
            this.pollTimers.set(projectPath, timer);
        };
        
        poll();
    }
    
    /**
     * Update known state for a project
     */
    private async updateKnownState(projectPath: string): Promise<void> {
        const sessions = await listSessions(projectPath);
        const stateMap = new Map<string, number>();
        
        for (const session of sessions) {
            stateMap.set(session.sessionId, session.fileMtime);
        }
        
        this.lastKnownState.set(projectPath, stateMap);
    }
    
    /**
     * Check for changes in a project
     */
    private async checkForChanges(projectPath: string): Promise<void> {
        const previousState = this.lastKnownState.get(projectPath) || new Map();
        const sessions = await listSessions(projectPath);
        
        for (const session of sessions) {
            // Skip sessions we own
            if (this.ownedSessions.has(session.sessionId)) {
                continue;
            }
            
            const prevMtime = previousState.get(session.sessionId);
            
            if (prevMtime === undefined) {
                // New session
                this.emit('session_new', session);
            } else if (prevMtime !== session.fileMtime) {
                // Updated session
                this.emit('session_updated', session);
            }
        }
        
        await this.updateKnownState(projectPath);
    }
    
    /**
     * Stop watching a project
     */
    unwatchProject(projectPath: string): void {
        const watcher = this.watchers.get(projectPath);
        if (watcher) {
            watcher.close();
            this.watchers.delete(projectPath);
        }
        
        const timer = this.pollTimers.get(projectPath);
        if (timer) {
            clearTimeout(timer);
            this.pollTimers.delete(projectPath);
        }
        
        this.lastKnownState.delete(projectPath);
    }
    
    /**
     * Stop all watchers
     */
    close(): void {
        for (const [path] of this.watchers) {
            this.unwatchProject(path);
        }
    }
}

// ============================================================================
// Exports
// ============================================================================

export {
    getClaudeDir,
    getProjectsDir
};
