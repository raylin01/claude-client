"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskMessageQueue = void 0;
class TaskMessageQueue {
    queue = new Map();
    async enqueue(taskId, message) {
        const list = this.queue.get(taskId) || [];
        list.push(message);
        this.queue.set(taskId, list);
    }
    async dequeue(taskId) {
        const list = this.queue.get(taskId);
        if (!list || list.length === 0)
            return undefined;
        const msg = list.shift();
        if (list.length === 0) {
            this.queue.delete(taskId);
        }
        else {
            this.queue.set(taskId, list);
        }
        return msg;
    }
    async dequeueAll(taskId) {
        const list = this.queue.get(taskId) || [];
        this.queue.delete(taskId);
        return list;
    }
    clear(taskId) {
        if (taskId) {
            this.queue.delete(taskId);
            return;
        }
        this.queue.clear();
    }
}
exports.TaskMessageQueue = TaskMessageQueue;
