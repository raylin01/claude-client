export interface TaskMessage {
    taskId: string;
    sessionId?: string;
    message: any;
    timestamp: Date;
}

export class TaskMessageQueue {
    private queue = new Map<string, TaskMessage[]>();

    async enqueue(taskId: string, message: TaskMessage): Promise<void> {
        const list = this.queue.get(taskId) || [];
        list.push(message);
        this.queue.set(taskId, list);
    }

    async dequeue(taskId: string): Promise<TaskMessage | undefined> {
        const list = this.queue.get(taskId);
        if (!list || list.length === 0) return undefined;
        const msg = list.shift();
        if (list.length === 0) {
            this.queue.delete(taskId);
        } else {
            this.queue.set(taskId, list);
        }
        return msg;
    }

    async dequeueAll(taskId: string): Promise<TaskMessage[]> {
        const list = this.queue.get(taskId) || [];
        this.queue.delete(taskId);
        return list;
    }

    clear(taskId?: string): void {
        if (taskId) {
            this.queue.delete(taskId);
            return;
        }
        this.queue.clear();
    }
}
