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

export class TaskStore extends EventEmitter {
    private tasks = new Map<string, TaskRecord>();

    createTask(id: string, data: Partial<TaskRecord> = {}): TaskRecord {
        const now = new Date();
        const task: TaskRecord = {
            id,
            status: 'queued',
            createdAt: now,
            updatedAt: now,
            ...data
        };
        this.tasks.set(id, task);
        this.emit('created', task);
        return task;
    }

    updateTask(id: string, updates: Partial<TaskRecord>): TaskRecord | null {
        const task = this.tasks.get(id);
        if (!task) return null;
        const updated = {
            ...task,
            ...updates,
            updatedAt: new Date()
        };
        this.tasks.set(id, updated);
        this.emit('updated', updated);
        return updated;
    }

    setStatus(id: string, status: TaskStatus, updates: Partial<TaskRecord> = {}): TaskRecord | null {
        return this.updateTask(id, { status, ...updates });
    }

    completeTask(id: string, output?: any): TaskRecord | null {
        return this.setStatus(id, 'completed', { output });
    }

    failTask(id: string, error: string, output?: any): TaskRecord | null {
        return this.setStatus(id, 'failed', { error, output });
    }

    cancelTask(id: string, reason?: string): TaskRecord | null {
        return this.setStatus(id, 'cancelled', { error: reason });
    }

    getTask(id: string): TaskRecord | null {
        return this.tasks.get(id) || null;
    }

    listTasks(): TaskRecord[] {
        return Array.from(this.tasks.values());
    }

    clear(): void {
        this.tasks.clear();
    }
}
