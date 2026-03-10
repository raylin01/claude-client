"use strict";
/**
 * Session Discovery & Management
 *
 * Utilities for reading Claude Code session data from ~/.claude/projects/
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionWatcher = void 0;
exports.escapeProjectPath = escapeProjectPath;
exports.unescapeProjectPath = unescapeProjectPath;
exports.getProjectStoragePath = getProjectStoragePath;
exports.listProjects = listProjects;
exports.listProjectsAsync = listProjectsAsync;
exports.listSessions = listSessions;
exports.getSessionDetails = getSessionDetails;
exports.getSessionDetailsAsync = getSessionDetailsAsync;
exports.getMessagesSince = getMessagesSince;
exports.normalizeClaudeSessionMessages = normalizeClaudeSessionMessages;
exports.listClaudeSessionSummaries = listClaudeSessionSummaries;
exports.readClaudeSessionRecord = readClaudeSessionRecord;
exports.getClaudeDir = getClaudeDir;
exports.getProjectsDir = getProjectsDir;
const fs_1 = require("fs");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const os_1 = require("os");
const events_1 = require("events");
// ============================================================================
// Session Discovery Service
// ============================================================================
function getClaudeDir(options = {}) {
    if (options.claudeDir)
        return options.claudeDir;
    return (0, path_1.join)(options.homeDir || (0, os_1.homedir)(), '.claude');
}
function getProjectsDir(options = {}) {
    return (0, path_1.join)(getClaudeDir(options), 'projects');
}
/**
 * Convert project path to escaped directory name
 */
function escapeProjectPath(projectPath) {
    // Match Claude Code extension encoding: replace any non-alphanumeric with '-'
    // This is lossy but ensures we hit the correct storage folder name.
    return projectPath.replace(/[^a-zA-Z0-9]/g, '-');
}
/**
 * Convert escaped directory name back to project path
 */
function unescapeProjectPath(escapedPath) {
    // Legacy fallback only. This is lossy because the extension encoding is lossy.
    // Prefer reading projectPath from sessions-index.json when available.
    return escapedPath.replace(/-/g, '/');
}
function deriveProjectPath(storagePath, escapedPath) {
    const indexPath = (0, path_1.join)(storagePath, 'sessions-index.json');
    if ((0, fs_1.existsSync)(indexPath)) {
        try {
            const index = JSON.parse((0, fs_1.readFileSync)(indexPath, 'utf-8'));
            const entryPath = index.entries?.find(e => typeof e.projectPath === 'string')?.projectPath;
            if (entryPath && (0, path_1.isAbsolute)(entryPath)) {
                return entryPath;
            }
        }
        catch {
            // Fall back to legacy unescape
        }
    }
    return unescapeProjectPath(escapedPath);
}
/**
 * Get the storage path for a project
 */
function getProjectStoragePath(projectPath, options = {}) {
    return (0, path_1.join)(getProjectsDir(options), escapeProjectPath(projectPath));
}
/**
 * List all projects known to Claude Code
 */
function listProjects(options = {}) {
    const projectsDir = getProjectsDir(options);
    if (!(0, fs_1.existsSync)(projectsDir)) {
        return [];
    }
    const projects = [];
    try {
        const dirs = (0, fs_1.readdirSync)(projectsDir, { withFileTypes: true });
        for (const dir of dirs) {
            if (!dir.isDirectory())
                continue;
            if (dir.name === '.' || dir.name === '..')
                continue;
            const storagePath = (0, path_1.join)(projectsDir, dir.name);
            const projectPath = deriveProjectPath(storagePath, dir.name);
            // Get session count
            let sessionCount = 0;
            const indexPath = (0, path_1.join)(storagePath, 'sessions-index.json');
            if ((0, fs_1.existsSync)(indexPath)) {
                try {
                    const index = JSON.parse((0, fs_1.readFileSync)(indexPath, 'utf-8'));
                    sessionCount = index.entries?.length || 0;
                }
                catch (e) {
                    // Count JSONL files as fallback
                    const files = (0, fs_1.readdirSync)(storagePath);
                    sessionCount = files.filter(f => f.endsWith('.jsonl')).length;
                }
            }
            // Get last modified
            const stat = (0, fs_1.statSync)(storagePath);
            projects.push({
                path: projectPath,
                escapedPath: dir.name,
                storagePath,
                sessionCount,
                lastModified: stat.mtime
            });
        }
    }
    catch (e) {
        console.error('Error reading projects directory:', e);
    }
    return projects.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}
/**
 * Async version of listProjects to avoid blocking the event loop
 */
async function listProjectsAsync(options = {}) {
    const projectsDir = getProjectsDir(options);
    if (!(0, fs_1.existsSync)(projectsDir)) {
        return [];
    }
    const projects = [];
    try {
        const dirs = await (0, promises_1.readdir)(projectsDir, { withFileTypes: true });
        for (const dir of dirs) {
            if (!dir.isDirectory())
                continue;
            if (dir.name === '.' || dir.name === '..')
                continue;
            const storagePath = (0, path_1.join)(projectsDir, dir.name);
            const projectPath = deriveProjectPath(storagePath, dir.name);
            let sessionCount = 0;
            const indexPath = (0, path_1.join)(storagePath, 'sessions-index.json');
            if ((0, fs_1.existsSync)(indexPath)) {
                try {
                    const index = JSON.parse(await (0, promises_1.readFile)(indexPath, 'utf-8'));
                    sessionCount = index.entries?.length || 0;
                }
                catch {
                    const files = await (0, promises_1.readdir)(storagePath);
                    sessionCount = files.filter(f => f.endsWith('.jsonl')).length;
                }
            }
            const statInfo = await (0, promises_1.stat)(storagePath);
            projects.push({
                path: projectPath,
                escapedPath: dir.name,
                storagePath,
                sessionCount,
                lastModified: statInfo.mtime
            });
        }
    }
    catch (e) {
        console.error('Error reading projects directory:', e);
    }
    return projects.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}
/**
 * List sessions for a specific project
 */
async function listSessions(projectPath, options = {}) {
    const storagePath = getProjectStoragePath(projectPath, options);
    const indexPath = (0, path_1.join)(storagePath, 'sessions-index.json');
    if (!(0, fs_1.existsSync)(indexPath)) {
        return [];
    }
    try {
        const { readFile } = await Promise.resolve().then(() => __importStar(require('fs/promises')));
        const content = await readFile(indexPath, 'utf-8');
        const index = JSON.parse(content);
        return (index.entries || []).sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
    }
    catch {
        return [];
    }
}
/**
 * Get detailed information about a session
 */
function getSessionDetails(sessionId, projectPath, options = {}) {
    const storagePath = getProjectStoragePath(projectPath, options);
    const sessionPath = (0, path_1.join)(storagePath, `${sessionId}.jsonl`);
    if (!(0, fs_1.existsSync)(sessionPath)) {
        return null;
    }
    try {
        const content = (0, fs_1.readFileSync)(sessionPath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());
        const messages = [];
        let summary;
        let gitBranch;
        let created;
        let modified;
        for (const line of lines) {
            try {
                const msg = JSON.parse(line);
                messages.push(msg);
                if (msg.type === 'summary' && msg.summary) {
                    summary = msg.summary;
                }
                if (msg.gitBranch) {
                    gitBranch = msg.gitBranch;
                }
                if (msg.timestamp) {
                    const ts = new Date(msg.timestamp);
                    if (!created || ts < created)
                        created = ts;
                    if (!modified || ts > modified)
                        modified = ts;
                }
            }
            catch (e) {
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
    }
    catch (e) {
        console.error('Error reading session details:', e);
        return null;
    }
}
/**
 * Async version of getSessionDetails to avoid blocking the event loop
 */
async function getSessionDetailsAsync(sessionId, projectPath, options = {}) {
    const storagePath = getProjectStoragePath(projectPath, options);
    const sessionPath = (0, path_1.join)(storagePath, `${sessionId}.jsonl`);
    if (!(0, fs_1.existsSync)(sessionPath)) {
        return null;
    }
    try {
        const content = await (0, promises_1.readFile)(sessionPath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());
        const messages = [];
        let summary;
        let gitBranch;
        let created;
        let modified;
        for (const line of lines) {
            try {
                const msg = JSON.parse(line);
                messages.push(msg);
                if (msg.type === 'summary' && msg.summary) {
                    summary = msg.summary;
                }
                if (msg.gitBranch) {
                    gitBranch = msg.gitBranch;
                }
                if (msg.timestamp) {
                    const ts = new Date(msg.timestamp);
                    if (!created || ts < created)
                        created = ts;
                    if (!modified || ts > modified)
                        modified = ts;
                }
            }
            catch {
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
    }
    catch (e) {
        console.error('Error reading session details:', e);
        return null;
    }
}
/**
 * Get messages from a session since a given timestamp
 */
function getMessagesSince(sessionId, projectPath, since, options = {}) {
    const details = getSessionDetails(sessionId, projectPath, options);
    if (!details)
        return [];
    return details.messages.filter(msg => {
        if (!msg.timestamp)
            return false;
        return new Date(msg.timestamp) > since;
    });
}
function toIsoTimestamp(value) {
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed))
            return new Date(parsed).toISOString();
    }
    if (typeof value === 'number') {
        const ms = value > 1_000_000_000_000 ? value : value * 1000;
        return new Date(ms).toISOString();
    }
    return new Date().toISOString();
}
function safeJson(value, maxChars = 1200) {
    try {
        const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        return raw.length > maxChars ? `${raw.slice(0, maxChars)}...` : raw;
    }
    catch {
        return String(value);
    }
}
function buildTranscriptMessage(role, createdAt, turnId, itemId, blockIndex, block) {
    return {
        id: `${turnId}:${itemId}:${blockIndex}`,
        role,
        createdAt,
        turnId,
        itemId,
        content: [block]
    };
}
function extractClaudeTextBlock(block) {
    if (!block)
        return null;
    if (typeof block?.text === 'string' && block.text.trim())
        return block.text.trim();
    if (typeof block?.content === 'string' && block.content.trim())
        return block.content.trim();
    return null;
}
function formatClaudeTodos(todos) {
    if (!Array.isArray(todos) || todos.length === 0)
        return null;
    const lines = todos.slice(0, 20).map((todo) => {
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
function extractFirstPrompt(messages) {
    for (const message of messages) {
        const content = Array.isArray(message?.message?.content) ? message.message.content : [];
        for (const block of content) {
            const text = extractClaudeTextBlock(block);
            if (text)
                return text;
        }
        if (typeof message?.summary === 'string' && message.summary.trim()) {
            return message.summary.trim();
        }
    }
    return 'Claude session';
}
function normalizeClaudeSessionMessages(rawMessages) {
    const messages = [];
    const resolvedToolUseIds = new Set();
    const pendingToolUses = new Map();
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
        if (rawType === 'queue-operation' ||
            rawType === 'file-history-snapshot' ||
            raw?.isSnapshotUpdate ||
            raw?.snapshot) {
            return;
        }
        const role = raw?.message?.role === 'user' || rawType === 'user' ? 'user' : 'assistant';
        const createdAt = toIsoTimestamp(raw?.timestamp ?? Date.now());
        const turnId = `claude-${raw?.sessionId || 'session'}`;
        const itemId = typeof raw?.uuid === 'string' && raw.uuid.trim() ? raw.uuid : `line-${index}`;
        const blocks = [];
        if (rawType === 'summary' && typeof raw?.summary === 'string' && raw.summary.trim()) {
            blocks.push({ type: 'text', text: raw.summary.trim() });
        }
        const content = Array.isArray(raw?.message?.content) ? raw.message.content : [];
        for (const block of content) {
            const blockType = typeof block?.type === 'string' ? block.type : 'unknown';
            if (blockType === 'text' || blockType === 'input_text' || blockType === 'output_text' || blockType === 'inputText') {
                const text = extractClaudeTextBlock(block);
                if (text)
                    blocks.push({ type: 'text', text });
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
                if (toolUseId)
                    resolvedToolUseIds.add(toolUseId);
                continue;
            }
            const fallback = safeJson(block, 900).trim();
            if (fallback) {
                blocks.push({ type: 'text', text: `[${blockType}] ${fallback}` });
            }
        }
        const todosText = formatClaudeTodos(raw?.todos);
        if (todosText) {
            blocks.push({
                type: 'plan',
                text: 'Todo List',
                explanation: todosText
            });
        }
        if (blocks.length === 0 && raw?.toolUseResult != null) {
            const toolResultText = typeof raw.toolUseResult === 'string'
                ? raw.toolUseResult
                : safeJson(raw.toolUseResult, 1200);
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
        if (resolvedToolUseIds.has(toolUseId))
            continue;
        if (pending.messageIndex < nearTailIndex)
            continue;
        messages.push(buildTranscriptMessage('assistant', pending.createdAt, pending.turnId, `${pending.itemId}-approval`, 0, {
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
        }));
    }
    return messages;
}
async function listClaudeSessionSummaries(projectPath, options = {}) {
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
async function readClaudeSessionRecord(sessionId, projectPath, options = {}) {
    const details = await getSessionDetailsAsync(sessionId, projectPath, options);
    if (!details)
        return null;
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
/**
 * Watch for session changes with adaptive polling
 */
class SessionWatcher extends events_1.EventEmitter {
    watchers = new Map();
    pollTimers = new Map();
    lastKnownState = new Map(); // projectPath -> sessionId -> mtime
    ownedSessions = new Set(); // Sessions we control (don't watch)
    pollIntervals = {
        active: 2000, // 2s when active
        recent: 10000, // 10s when recent activity
        idle: 60000 // 60s when idle
    };
    activityTimestamps = new Map(); // projectPath -> last activity
    /**
     * Mark a session as owned by this client (don't watch for external changes)
     */
    markAsOwned(sessionId) {
        this.ownedSessions.add(sessionId);
    }
    /**
     * Unmark a session as owned
     */
    unmarkAsOwned(sessionId) {
        this.ownedSessions.delete(sessionId);
    }
    /**
     * Record activity for a project (affects polling interval)
     */
    recordActivity(projectPath) {
        this.activityTimestamps.set(projectPath, Date.now());
    }
    /**
     * Get current poll interval for a project
     */
    getPollInterval(projectPath) {
        const lastActivity = this.activityTimestamps.get(projectPath) || 0;
        const elapsed = Date.now() - lastActivity;
        if (elapsed < 30000)
            return this.pollIntervals.active; // < 30s
        if (elapsed < 300000)
            return this.pollIntervals.recent; // < 5min
        return this.pollIntervals.idle;
    }
    /**
     * Start watching a project
     */
    watchProject(projectPath) {
        const storagePath = getProjectStoragePath(projectPath);
        if (!(0, fs_1.existsSync)(storagePath)) {
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
            const watcher = (0, fs_1.watch)(storagePath, { persistent: false }, (eventType, filename) => {
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
        }
        catch (e) {
            // Fall back to polling
            this.startPolling(projectPath);
        }
    }
    /**
     * Start polling for a project
     */
    startPolling(projectPath) {
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
    async updateKnownState(projectPath) {
        const sessions = await listSessions(projectPath);
        const stateMap = new Map();
        for (const session of sessions) {
            stateMap.set(session.sessionId, session.fileMtime);
        }
        this.lastKnownState.set(projectPath, stateMap);
    }
    /**
     * Check for changes in a project
     */
    async checkForChanges(projectPath) {
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
            }
            else if (prevMtime !== session.fileMtime) {
                // Updated session
                this.emit('session_updated', session);
            }
        }
        await this.updateKnownState(projectPath);
    }
    /**
     * Stop watching a project
     */
    unwatchProject(projectPath) {
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
    close() {
        for (const [path] of this.watchers) {
            this.unwatchProject(path);
        }
    }
}
exports.SessionWatcher = SessionWatcher;
