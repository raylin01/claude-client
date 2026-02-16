export interface TaskMessage {
    taskId: string;
    sessionId?: string;
    message: any;
    timestamp: Date;
}
export declare class TaskMessageQueue {
    private queue;
    enqueue(taskId: string, message: TaskMessage): Promise<void>;
    dequeue(taskId: string): Promise<TaskMessage | undefined>;
    dequeueAll(taskId: string): Promise<TaskMessage[]>;
    clear(taskId?: string): void;
}
