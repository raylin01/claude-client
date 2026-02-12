/**
 * Session Discovery & Management
 *
 * Utilities for reading Claude Code session data from ~/.claude/projects/
 */
import { EventEmitter } from 'events';
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
declare const CLAUDE_DIR: string;
declare const PROJECTS_DIR: string;
/**
 * Convert project path to escaped directory name
 */
export declare function escapeProjectPath(projectPath: string): string;
/**
 * Convert escaped directory name back to project path
 */
export declare function unescapeProjectPath(escapedPath: string): string;
/**
 * Get the storage path for a project
 */
export declare function getProjectStoragePath(projectPath: string): string;
/**
 * List all projects known to Claude Code
 */
export declare function listProjects(): ProjectInfo[];
/**
 * List sessions for a specific project
 */
/**
 * List sessions for a specific project
 */
export declare function listSessions(projectPath: string): Promise<SessionEntry[]>;
/**
 * Get detailed information about a session
 */
export declare function getSessionDetails(sessionId: string, projectPath: string): SessionDetails | null;
/**
 * Get messages from a session since a given timestamp
 */
export declare function getMessagesSince(sessionId: string, projectPath: string, since: Date): SessionMessage[];
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
export declare class SessionWatcher extends EventEmitter {
    private watchers;
    private pollTimers;
    private lastKnownState;
    private ownedSessions;
    private pollIntervals;
    private activityTimestamps;
    /**
     * Mark a session as owned by this client (don't watch for external changes)
     */
    markAsOwned(sessionId: string): void;
    /**
     * Unmark a session as owned
     */
    unmarkAsOwned(sessionId: string): void;
    /**
     * Record activity for a project (affects polling interval)
     */
    recordActivity(projectPath: string): void;
    /**
     * Get current poll interval for a project
     */
    private getPollInterval;
    /**
     * Start watching a project
     */
    watchProject(projectPath: string): void;
    /**
     * Start polling for a project
     */
    private startPolling;
    /**
     * Update known state for a project
     */
    private updateKnownState;
    /**
     * Check for changes in a project
     */
    private checkForChanges;
    /**
     * Stop watching a project
     */
    unwatchProject(projectPath: string): void;
    /**
     * Stop all watchers
     */
    close(): void;
}
export { CLAUDE_DIR, PROJECTS_DIR };
