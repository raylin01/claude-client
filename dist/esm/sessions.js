/**
 * Session Discovery & Management
 *
 * Utilities for reading Claude Code session data from ~/.claude/projects/
 */
import { readFileSync, readdirSync, existsSync, statSync, watch } from 'fs';
import { readFile, readdir, stat } from 'fs/promises';
import { join, isAbsolute } from 'path';
import { homedir } from 'os';
import { EventEmitter } from 'events';
// ============================================================================
// Session Discovery Service
// ============================================================================
const CLAUDE_DIR = join(homedir(), '.claude');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');
/**
 * Convert project path to escaped directory name
 */
export function escapeProjectPath(projectPath) {
    // Match Claude Code extension encoding: replace any non-alphanumeric with '-'
    // This is lossy but ensures we hit the correct storage folder name.
    return projectPath.replace(/[^a-zA-Z0-9]/g, '-');
}
/**
 * Convert escaped directory name back to project path
 */
export function unescapeProjectPath(escapedPath) {
    // Legacy fallback only. This is lossy because the extension encoding is lossy.
    // Prefer reading projectPath from sessions-index.json when available.
    return escapedPath.replace(/-/g, '/');
}
function deriveProjectPath(storagePath, escapedPath) {
    const indexPath = join(storagePath, 'sessions-index.json');
    if (existsSync(indexPath)) {
        try {
            const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
            const entryPath = index.entries?.find(e => typeof e.projectPath === 'string')?.projectPath;
            if (entryPath && isAbsolute(entryPath)) {
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
export function getProjectStoragePath(projectPath) {
    return join(PROJECTS_DIR, escapeProjectPath(projectPath));
}
/**
 * List all projects known to Claude Code
 */
export function listProjects() {
    if (!existsSync(PROJECTS_DIR)) {
        return [];
    }
    const projects = [];
    try {
        const dirs = readdirSync(PROJECTS_DIR, { withFileTypes: true });
        for (const dir of dirs) {
            if (!dir.isDirectory())
                continue;
            if (dir.name === '.' || dir.name === '..')
                continue;
            const storagePath = join(PROJECTS_DIR, dir.name);
            const projectPath = deriveProjectPath(storagePath, dir.name);
            // Get session count
            let sessionCount = 0;
            const indexPath = join(storagePath, 'sessions-index.json');
            if (existsSync(indexPath)) {
                try {
                    const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
                    sessionCount = index.entries?.length || 0;
                }
                catch (e) {
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
    }
    catch (e) {
        console.error('Error reading projects directory:', e);
    }
    return projects.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}
/**
 * Async version of listProjects to avoid blocking the event loop
 */
export async function listProjectsAsync() {
    if (!existsSync(PROJECTS_DIR)) {
        return [];
    }
    const projects = [];
    try {
        const dirs = await readdir(PROJECTS_DIR, { withFileTypes: true });
        for (const dir of dirs) {
            if (!dir.isDirectory())
                continue;
            if (dir.name === '.' || dir.name === '..')
                continue;
            const storagePath = join(PROJECTS_DIR, dir.name);
            const projectPath = deriveProjectPath(storagePath, dir.name);
            let sessionCount = 0;
            const indexPath = join(storagePath, 'sessions-index.json');
            if (existsSync(indexPath)) {
                try {
                    const index = JSON.parse(await readFile(indexPath, 'utf-8'));
                    sessionCount = index.entries?.length || 0;
                }
                catch {
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
    }
    catch (e) {
        console.error('Error reading projects directory:', e);
    }
    return projects.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}
/**
 * List sessions for a specific project
 */
export async function listSessions(projectPath) {
    const storagePath = getProjectStoragePath(projectPath);
    const indexPath = join(storagePath, 'sessions-index.json');
    if (!existsSync(indexPath)) {
        return [];
    }
    try {
        const { readFile } = await import('fs/promises');
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
export function getSessionDetails(sessionId, projectPath) {
    const storagePath = getProjectStoragePath(projectPath);
    const sessionPath = join(storagePath, `${sessionId}.jsonl`);
    if (!existsSync(sessionPath)) {
        return null;
    }
    try {
        const content = readFileSync(sessionPath, 'utf-8');
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
export async function getSessionDetailsAsync(sessionId, projectPath) {
    const storagePath = getProjectStoragePath(projectPath);
    const sessionPath = join(storagePath, `${sessionId}.jsonl`);
    if (!existsSync(sessionPath)) {
        return null;
    }
    try {
        const content = await readFile(sessionPath, 'utf-8');
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
export function getMessagesSince(sessionId, projectPath, since) {
    const details = getSessionDetails(sessionId, projectPath);
    if (!details)
        return [];
    return details.messages.filter(msg => {
        if (!msg.timestamp)
            return false;
        return new Date(msg.timestamp) > since;
    });
}
/**
 * Watch for session changes with adaptive polling
 */
export class SessionWatcher extends EventEmitter {
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
// ============================================================================
// Exports
// ============================================================================
export { CLAUDE_DIR, PROJECTS_DIR };
