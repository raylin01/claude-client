"use strict";
/**
 * Session Discovery & Management
 *
 * Utilities for reading Claude Code session data from ~/.claude/projects/
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROJECTS_DIR = exports.CLAUDE_DIR = exports.SessionWatcher = void 0;
exports.escapeProjectPath = escapeProjectPath;
exports.unescapeProjectPath = unescapeProjectPath;
exports.getProjectStoragePath = getProjectStoragePath;
exports.listProjects = listProjects;
exports.listSessions = listSessions;
exports.getSessionDetails = getSessionDetails;
exports.getMessagesSince = getMessagesSince;
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const events_1 = require("events");
// ============================================================================
// Session Discovery Service
// ============================================================================
const CLAUDE_DIR = (0, path_1.join)((0, os_1.homedir)(), '.claude');
exports.CLAUDE_DIR = CLAUDE_DIR;
const PROJECTS_DIR = (0, path_1.join)(CLAUDE_DIR, 'projects');
exports.PROJECTS_DIR = PROJECTS_DIR;
/**
 * Convert project path to escaped directory name
 */
function escapeProjectPath(projectPath) {
    return projectPath.replace(/\//g, '-');
}
/**
 * Convert escaped directory name back to project path
 */
function unescapeProjectPath(escapedPath) {
    // First char is always '-' for absolute paths
    return escapedPath.replace(/-/g, '/');
}
/**
 * Get the storage path for a project
 */
function getProjectStoragePath(projectPath) {
    return (0, path_1.join)(PROJECTS_DIR, escapeProjectPath(projectPath));
}
/**
 * List all projects known to Claude Code
 */
function listProjects() {
    if (!(0, fs_1.existsSync)(PROJECTS_DIR)) {
        return [];
    }
    const projects = [];
    try {
        const dirs = (0, fs_1.readdirSync)(PROJECTS_DIR, { withFileTypes: true });
        for (const dir of dirs) {
            if (!dir.isDirectory())
                continue;
            if (dir.name === '.' || dir.name === '..')
                continue;
            const storagePath = (0, path_1.join)(PROJECTS_DIR, dir.name);
            const projectPath = unescapeProjectPath(dir.name);
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
 * List sessions for a specific project
 */
function listSessions(projectPath) {
    const storagePath = getProjectStoragePath(projectPath);
    const indexPath = (0, path_1.join)(storagePath, 'sessions-index.json');
    if (!(0, fs_1.existsSync)(indexPath)) {
        return [];
    }
    try {
        const index = JSON.parse((0, fs_1.readFileSync)(indexPath, 'utf-8'));
        return (index.entries || []).sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
    }
    catch (e) {
        console.error('Error reading sessions index:', e);
        return [];
    }
}
/**
 * Get detailed information about a session
 */
function getSessionDetails(sessionId, projectPath) {
    const storagePath = getProjectStoragePath(projectPath);
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
 * Get messages from a session since a given timestamp
 */
function getMessagesSince(sessionId, projectPath, since) {
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
        this.updateKnownState(projectPath);
        // Try to use fs.watch first
        try {
            const watcher = (0, fs_1.watch)(storagePath, { persistent: false }, (eventType, filename) => {
                if (filename === 'sessions-index.json' || filename?.endsWith('.jsonl')) {
                    this.recordActivity(projectPath);
                    this.checkForChanges(projectPath);
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
            this.checkForChanges(projectPath);
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
    updateKnownState(projectPath) {
        const sessions = listSessions(projectPath);
        const stateMap = new Map();
        for (const session of sessions) {
            stateMap.set(session.sessionId, session.fileMtime);
        }
        this.lastKnownState.set(projectPath, stateMap);
    }
    /**
     * Check for changes in a project
     */
    checkForChanges(projectPath) {
        const previousState = this.lastKnownState.get(projectPath) || new Map();
        const sessions = listSessions(projectPath);
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
        this.updateKnownState(projectPath);
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
