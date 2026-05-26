import { Envelope, buildEnvelope } from './envelope';
import { signEnvelope } from './crypto';
import { canonicalize } from './canonical';
import { randomBytes } from 'crypto';

export type TaskStatus = 'PENDING' | 'WORKING' | 'COMPLETED' | 'FAILED' | 'CANCELED';

export interface Task {
  taskId: string;
  status: TaskStatus;
  capability: string;
  input: unknown;
  result?: unknown;
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskParams {
  capability: string;
  input: unknown;
  context_id?: string;
}

export interface GetTaskResult {
  task_id: string;
  status: TaskStatus;
  result?: unknown;
  error?: { code: string; message: string };
  created_at: string;
  updated_at: string;
}

export class TaskManager {
  private tasks: Map<string, Task> = new Map();

  create(capability: string, input: unknown): Task {
    const taskId = 'task_' + randomBytes(8).toString('base64url');
    const now = new Date().toISOString();

    const task: Task = {
      taskId,
      status: 'PENDING',
      capability,
      input,
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(taskId, task);
    return task;
  }

  start(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('Task not found');
    if (task.status !== 'PENDING') {
      throw new Error(`Cannot start task in ${task.status} status`);
    }

    task.status = 'WORKING';
    task.updatedAt = new Date().toISOString();
    return task;
  }

  complete(taskId: string, result: unknown): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('Task not found');
    if (task.status !== 'WORKING') {
      throw new Error(`Cannot complete task in ${task.status} status`);
    }

    task.status = 'COMPLETED';
    task.result = result;
    task.updatedAt = new Date().toISOString();
    return task;
  }

  fail(taskId: string, error: { code: string; message: string }): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('Task not found');
    if (task.status !== 'WORKING') {
      throw new Error(`Cannot fail task in ${task.status} status`);
    }

    task.status = 'FAILED';
    task.error = error;
    task.updatedAt = new Date().toISOString();
    return task;
  }

  cancel(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('Task not found');
    if (task.status === 'COMPLETED' || task.status === 'FAILED' || task.status === 'CANCELED') {
      throw new Error(`Cannot cancel task in ${task.status} status`);
    }

    task.status = 'CANCELED';
    task.updatedAt = new Date().toISOString();
    return task;
  }

  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  list(filter?: { status?: TaskStatus; cursor?: string; limit?: number }): { tasks: Task[]; nextCursor: string | null } {
    let tasks = Array.from(this.tasks.values());

    if (filter?.status) {
      tasks = tasks.filter((t) => t.status === filter.status);
    }

    tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const limit = filter?.limit ?? 20;
    let start = 0;
    if (filter?.cursor) {
      // Build a taskId -> index map for O(1) cursor lookup
      const indexMap = new Map<string, number>();
      for (let i = 0; i < tasks.length; i++) {
        indexMap.set(tasks[i].taskId, i);
        if (indexMap.has(filter.cursor)) break; // early exit once we found the cursor
      }
      const cursorIdx = indexMap.get(filter.cursor);
      start = cursorIdx !== undefined ? cursorIdx + 1 : 0;
    }

    const page = tasks.slice(start, start + limit);
    const nextCursor = start + limit < tasks.length ? page[page.length - 1].taskId : null;

    return { tasks: page, nextCursor };
  }

  async handleCreateTask(envelope: Envelope, secretKey: Uint8Array): Promise<Envelope> {
    const params = envelope.params as CreateTaskParams;
    const task = this.create(params.capability, params.input);

    const reply = buildEnvelope(
      envelope.to,
      envelope.from,
      'adp:task.create',
      {
        task_id: task.taskId,
        status: task.status,
      },
      { reply_to: envelope.id }
    );

    return signEnvelope(reply, secretKey, canonicalize) as unknown as Envelope;
  }

  async handleGetTask(envelope: Envelope, secretKey: Uint8Array): Promise<Envelope> {
    const params = envelope.params as { task_id: string };
    const task = this.get(params.task_id);

    if (!task) {
      const reply = buildEnvelope(
        envelope.to,
        envelope.from,
        'adp:task.get',
        {},
        {
          reply_to: envelope.id,
          error: { code: 'AGENT_NOT_FOUND', message: 'Task not found' },
        }
      );
      return signEnvelope(reply, secretKey, canonicalize) as unknown as Envelope;
    }

    const result: GetTaskResult = {
      task_id: task.taskId,
      status: task.status,
      result: task.result,
      error: task.error,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
    };

    const reply = buildEnvelope(
      envelope.to,
      envelope.from,
      'adp:task.get',
      result,
      { reply_to: envelope.id }
    );

    return signEnvelope(reply, secretKey, canonicalize) as unknown as Envelope;
  }

  async handleListTasks(envelope: Envelope, secretKey: Uint8Array): Promise<Envelope> {
    const params = envelope.params as { status?: TaskStatus; cursor?: string; limit?: number };
    const { tasks, nextCursor } = this.list(params);

    const taskSummaries = tasks.map((task) => ({
      task_id: task.taskId,
      status: task.status,
      capability: task.capability,
      created_at: task.createdAt,
    }));

    const reply = buildEnvelope(
      envelope.to,
      envelope.from,
      'adp:task.list',
      { tasks: taskSummaries, next_cursor: nextCursor },
      { reply_to: envelope.id }
    );

    return signEnvelope(reply, secretKey, canonicalize) as unknown as Envelope;
  }

  async handleCancelTask(envelope: Envelope, secretKey: Uint8Array): Promise<Envelope> {
    const params = envelope.params as { task_id: string };

    try {
      const task = this.cancel(params.task_id);

      const reply = buildEnvelope(
        envelope.to,
        envelope.from,
        'adp:task.cancel',
        { task_id: task.taskId, status: task.status },
        { reply_to: envelope.id }
      );

      return signEnvelope(reply, secretKey, canonicalize) as unknown as Envelope;
    } catch (err) {
      const reply = buildEnvelope(
        envelope.to,
        envelope.from,
        'adp:task.cancel',
        {},
        {
          reply_to: envelope.id,
          error: { code: 'INTERNAL_ERROR', message: (err as Error).message },
        }
      );
      return signEnvelope(reply, secretKey, canonicalize) as unknown as Envelope;
    }
  }
}
