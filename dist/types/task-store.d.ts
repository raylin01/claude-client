import { EventEmitter } from 'events';
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface TaskRecord {
    id: string;
    sessionId?: string;
    status: TaskStatus;
    createdAt: Date;
    updatedAt: Date;
    input?: any;
    output?: any;
    error?: string;
    metadata?: Record<string, any>;
}
export declare class TaskStore extends EventEmitter {
    private tasks;
    createTask(id: string, data?: Partial<TaskRecord>): TaskRecord;
    updateTask(id: string, updates: Partial<TaskRecord>): TaskRecord | null;
    setStatus(id: string, status: TaskStatus, updates?: Partial<TaskRecord>): TaskRecord | null;
    completeTask(id: string, output?: any): TaskRecord | null;
    failTask(id: string, error: string, output?: any): TaskRecord | null;
    cancelTask(id: string, reason?: string): TaskRecord | null;
    getTask(id: string): TaskRecord | null;
    listTasks(): TaskRecord[];
    clear(): void;
}
