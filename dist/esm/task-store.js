import { EventEmitter } from 'events';
export class TaskStore extends EventEmitter {
    tasks = new Map();
    createTask(id, data = {}) {
        const now = new Date();
        const task = {
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
    updateTask(id, updates) {
        const task = this.tasks.get(id);
        if (!task)
            return null;
        const updated = {
            ...task,
            ...updates,
            updatedAt: new Date()
        };
        this.tasks.set(id, updated);
        this.emit('updated', updated);
        return updated;
    }
    setStatus(id, status, updates = {}) {
        return this.updateTask(id, { status, ...updates });
    }
    completeTask(id, output) {
        return this.setStatus(id, 'completed', { output });
    }
    failTask(id, error, output) {
        return this.setStatus(id, 'failed', { error, output });
    }
    cancelTask(id, reason) {
        return this.setStatus(id, 'cancelled', { error: reason });
    }
    getTask(id) {
        return this.tasks.get(id) || null;
    }
    listTasks() {
        return Array.from(this.tasks.values());
    }
    clear() {
        this.tasks.clear();
    }
}
