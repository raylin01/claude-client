/**
 * Session Discovery & Management
 * 
 * Utilities for reading Claude Code session data from ~/.claude/projects/
 */

import { readFileSync, readdirSync, existsSync, statSync, watch, FSWatcher } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { EventEmitter } from 'events';

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

const CLAUDE_DIR = join(homedir(), '.claude');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');

/**
 * Convert project path to escaped directory name
 */
export function escapeProjectPath(projectPath: string): string {
    return projectPath.replace(/\//g, '-');
}

/**
 * Convert escaped directory name back to project path
 */
export function unescapeProjectPath(escapedPath: string): string {
    // First char is always '-' for absolute paths
    return escapedPath.replace(/-/g, '/');
}

/**
 * Get the storage path for a project
 */
export function getProjectStoragePath(projectPath: string): string {
    return join(PROJECTS_DIR, escapeProjectPath(projectPath));
}

/**
 * List all projects known to Claude Code
 */
export function listProjects(): ProjectInfo[] {
    if (!existsSync(PROJECTS_DIR)) {
        return [];
    }

    const projects: ProjectInfo[] = [];
    
    try {
        const dirs = readdirSync(PROJECTS_DIR, { withFileTypes: true });
        
        for (const dir of dirs) {
            if (!dir.isDirectory()) continue;
            if (dir.name === '.' || dir.name === '..') continue;
            
            const storagePath = join(PROJECTS_DIR, dir.name);
            const projectPath = unescapeProjectPath(dir.name);
            
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
 * List sessions for a specific project
 */
export function listSessions(projectPath: string): SessionEntry[] {
    const storagePath = getProjectStoragePath(projectPath);
    const indexPath = join(storagePath, 'sessions-index.json');
    
    if (!existsSync(indexPath)) {
        return [];
    }
    
    try {
        const index = JSON.parse(readFileSync(indexPath, 'utf-8')) as SessionsIndex;
        return (index.entries || []).sort((a, b) => 
            new Date(b.modified).getTime() - new Date(a.modified).getTime()
        );
    } catch (e) {
        console.error('Error reading sessions index:', e);
        return [];
    }
}

/**
 * Get detailed information about a session
 */
export function getSessionDetails(sessionId: string, projectPath: string): SessionDetails | null {
    const storagePath = getProjectStoragePath(projectPath);
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
 * Get messages from a session since a given timestamp
 */
export function getMessagesSince(sessionId: string, projectPath: string, since: Date): SessionMessage[] {
    const details = getSessionDetails(sessionId, projectPath);
    if (!details) return [];
    
    return details.messages.filter(msg => {
        if (!msg.timestamp) return false;
        return new Date(msg.timestamp) > since;
    });
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
        this.updateKnownState(projectPath);
        
        // Try to use fs.watch first
        try {
            const watcher = watch(storagePath, { persistent: false }, (eventType, filename) => {
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
    private updateKnownState(projectPath: string): void {
        const sessions = listSessions(projectPath);
        const stateMap = new Map<string, number>();
        
        for (const session of sessions) {
            stateMap.set(session.sessionId, session.fileMtime);
        }
        
        this.lastKnownState.set(projectPath, stateMap);
    }
    
    /**
     * Check for changes in a project
     */
    private checkForChanges(projectPath: string): void {
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
            } else if (prevMtime !== session.fileMtime) {
                // Updated session
                this.emit('session_updated', session);
            }
        }
        
        this.updateKnownState(projectPath);
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
    CLAUDE_DIR,
    PROJECTS_DIR
};
