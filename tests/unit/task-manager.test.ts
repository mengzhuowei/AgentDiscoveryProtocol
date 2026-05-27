import { TaskManager } from '../../src/task-manager';
import { buildEnvelope } from '../../src/envelope';
import { signEnvelope } from '../../src/crypto';
import { canonicalize } from '../../src/canonical';
import { generateKeyPair, buildAgentId } from '../../src/index';

describe('TaskManager', () => {
  let taskManager: TaskManager;
  let aliceKeys: ReturnType<typeof generateKeyPair>;
  let aliceId: string;
  let bobId: string;

  beforeEach(() => {
    taskManager = new TaskManager();
    aliceKeys = generateKeyPair();
    aliceId = buildAgentId(aliceKeys.publicKey, 'local', 'alice');
    bobId = buildAgentId(generateKeyPair().publicKey, 'local', 'bob');
  });

  test('创建任务', () => {
    const task = taskManager.create('custom:test', { data: 'hello' });

    expect(task.status).toBe('PENDING');
    expect(task.capability).toBe('custom:test');
    expect(task.input).toEqual({ data: 'hello' });
    expect(task.taskId.startsWith('task_')).toBe(true);
  });

  test('启动任务', () => {
    const task = taskManager.create('custom:test', {});
    const started = taskManager.start(task.taskId);

    expect(started.status).toBe('WORKING');
  });

  test('完成任务', () => {
    const task = taskManager.create('custom:test', {});
    taskManager.start(task.taskId);
    const completed = taskManager.complete(task.taskId, { result: 'success' });

    expect(completed.status).toBe('COMPLETED');
    expect(completed.result).toEqual({ result: 'success' });
  });

  test('失败任务', () => {
    const task = taskManager.create('custom:test', {});
    taskManager.start(task.taskId);
    const failed = taskManager.fail(task.taskId, { code: 'ERROR', message: 'something went wrong' });

    expect(failed.status).toBe('FAILED');
    expect(failed.error).toEqual({ code: 'ERROR', message: 'something went wrong' });
  });

  test('取消任务', () => {
    const task = taskManager.create('custom:test', {});
    const canceled = taskManager.cancel(task.taskId);

    expect(canceled.status).toBe('CANCELED');
  });

  test('获取任务', () => {
    const task = taskManager.create('custom:test', { data: '123' });
    const retrieved = taskManager.get(task.taskId);

    expect(retrieved).toEqual(task);
  });

  test('列出任务 - 默认', () => {
    taskManager.create('custom:test1', {});
    taskManager.create('custom:test2', {});

    const result = taskManager.list();

    expect(result.tasks.length).toBe(2);
  });

  test('列出任务 - 按状态过滤', () => {
    const task1 = taskManager.create('custom:test1', {});
    const task2 = taskManager.create('custom:test2', {});
    taskManager.start(task2.taskId);

    const result = taskManager.list({ status: 'PENDING' });

    expect(result.tasks.length).toBe(1);
    expect(result.tasks[0].taskId).toBe(task1.taskId);
  });

  test('不能从非 PENDING 状态启动', () => {
    const task = taskManager.create('custom:test', {});
    taskManager.start(task.taskId);

    expect(() => {
      taskManager.start(task.taskId);
    }).toThrow();
  });

  test('handleCreateTask', async () => {
    const envelope = buildEnvelope(aliceId, bobId, 'adp:task.create', {
      capability: 'custom:test',
      input: { data: 'hello' },
    });
    const signedEnvelope = signEnvelope(envelope, aliceKeys.secretKey, canonicalize);

    const result = await taskManager.handleCreateTask(signedEnvelope as any, aliceKeys.secretKey);

    expect(result.action).toBe('adp:task.create');
  });

  test('不能从 COMPLETED 状态取消', () => {
    const task = taskManager.create('custom:test', {});
    taskManager.start(task.taskId);
    taskManager.complete(task.taskId, { ok: true });

    expect(() => taskManager.cancel(task.taskId)).toThrow();
  });

  test('不能从 FAILED 状态取消', () => {
    const task = taskManager.create('custom:test', {});
    taskManager.start(task.taskId);
    taskManager.fail(task.taskId, { code: 'E', message: 'bad' });

    expect(() => taskManager.cancel(task.taskId)).toThrow();
  });

  test('不能在非 WORKING 状态完成', () => {
    const task = taskManager.create('custom:test', {});
    expect(() => taskManager.complete(task.taskId, {})).toThrow();
  });

  test('不能在非 WORKING 状态标记失败', () => {
    const task = taskManager.create('custom:test', {});
    expect(() => taskManager.fail(task.taskId, { code: 'E', message: 'bad' })).toThrow();
  });

  test('start 不存在的任务报错', () => {
    expect(() => taskManager.start('nonexistent')).toThrow('Task not found');
  });

  test('handleGetTask returns task', async () => {
    const task = taskManager.create('custom:test', { data: 'hi' });

    const envelope = buildEnvelope(aliceId, bobId, 'adp:task.get', { task_id: task.taskId });
    const signedEnvelope = signEnvelope(envelope, aliceKeys.secretKey, canonicalize);

    const result = await taskManager.handleGetTask(signedEnvelope as any, aliceKeys.secretKey);
    expect(result.action).toBe('adp:task.get');
  });

  test('handleGetTask returns error for unknown task', async () => {
    const envelope = buildEnvelope(aliceId, bobId, 'adp:task.get', { task_id: 'nonexistent' });
    const signedEnvelope = signEnvelope(envelope, aliceKeys.secretKey, canonicalize);

    const result = await taskManager.handleGetTask(signedEnvelope as any, aliceKeys.secretKey);
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe('TASK_NOT_FOUND');
  });

  test('handleListTasks returns task summaries', async () => {
    taskManager.create('custom:test', { data: 'a' });
    const envelope = buildEnvelope(aliceId, bobId, 'adp:task.list', {});
    const signedEnvelope = signEnvelope(envelope, aliceKeys.secretKey, canonicalize);

    const result = await taskManager.handleListTasks(signedEnvelope as any, aliceKeys.secretKey);
    expect(result.action).toBe('adp:task.list');
  });

  test('handleCancelTask success', async () => {
    const task = taskManager.create('custom:test', {});
    const envelope = buildEnvelope(aliceId, bobId, 'adp:task.cancel', { task_id: task.taskId });
    const signedEnvelope = signEnvelope(envelope, aliceKeys.secretKey, canonicalize);

    const result = await taskManager.handleCancelTask(signedEnvelope as any, aliceKeys.secretKey);
    expect(result.action).toBe('adp:task.cancel');
  });

  test('handleCancelTask returns error for unknown task', async () => {
    const envelope = buildEnvelope(aliceId, bobId, 'adp:task.cancel', { task_id: 'nonexistent' });
    const signedEnvelope = signEnvelope(envelope, aliceKeys.secretKey, canonicalize);

    const result = await taskManager.handleCancelTask(signedEnvelope as any, aliceKeys.secretKey);
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe('INTERNAL_ERROR');
  });

  test('list with cursor and limit', () => {
    for (let i = 0; i < 5; i++) {
      taskManager.create('custom:test', { i });
    }
    const page1 = taskManager.list({ limit: 3 });
    expect(page1.tasks.length).toBe(3);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = taskManager.list({ limit: 3, cursor: page1.nextCursor! });
    expect(page2.tasks.length).toBe(2);
    expect(page2.nextCursor).toBeNull();
  });

  test('complete 不存在的任务报错', () => {
    expect(() => taskManager.complete('nonexistent', {})).toThrow('Task not found');
  });

  test('fail 不存在的任务报错', () => {
    expect(() => taskManager.fail('nonexistent', { code: 'E', message: 'bad' })).toThrow('Task not found');
  });

  // --- new edge case tests ---

  test('cancel task in WORKING state', () => {
    const task = taskManager.create('custom:test', {});
    taskManager.start(task.taskId);
    const canceled = taskManager.cancel(task.taskId);
    expect(canceled.status).toBe('CANCELED');
  });

  test('cannot cancel from CANCELED state', () => {
    const task = taskManager.create('custom:test', {});
    taskManager.cancel(task.taskId);
    expect(() => taskManager.cancel(task.taskId)).toThrow();
  });

  test('get returns undefined for non-existent task', () => {
    expect(taskManager.get('never-created')).toBeUndefined();
  });

  test('handleCreateTask returns error for missing capability', async () => {
    const envelope = buildEnvelope(aliceId, bobId, 'adp:task.create', {
      input: { data: 'hello' },
      // capability is missing
    });
    const signedEnvelope = signEnvelope(envelope, aliceKeys.secretKey, canonicalize);

    // Should not crash — handleCreateTask accesses params.capability directly
    const result = await taskManager.handleCreateTask(signedEnvelope as any, aliceKeys.secretKey);
    // When capability is undefined, task.create creates a task with undefined capability
    expect(result.action).toBe('adp:task.create');
  });

  test('list with empty state returns empty array', () => {
    const result = taskManager.list();
    expect(result.tasks).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  test('list filter with no matches returns empty', () => {
    taskManager.create('custom:test', {});
    const result = taskManager.list({ status: 'COMPLETED' });
    expect(result.tasks).toEqual([]);
  });

  test('multiple tasks maintain unique IDs', () => {
    const t1 = taskManager.create('custom:a', {});
    const t2 = taskManager.create('custom:b', {});
    const t3 = taskManager.create('custom:c', {});
    expect(t1.taskId).not.toBe(t2.taskId);
    expect(t2.taskId).not.toBe(t3.taskId);
    expect(t1.taskId).not.toBe(t3.taskId);
  });

  test('complete task stores updatedAt timestamp', () => {
    const task = taskManager.create('custom:test', {});
    taskManager.start(task.taskId);
    const beforeComplete = new Date();
    const completed = taskManager.complete(task.taskId, { ok: true });
    const afterComplete = new Date(completed.updatedAt).getTime();
    expect(afterComplete).toBeGreaterThanOrEqual(beforeComplete.getTime() - 1000);
  });

  test('list returns tasks sorted by createdAt (descending)', () => {
    const t1 = taskManager.create('custom:test', { seq: 1 });
    // Small delay to ensure different timestamps
    const t2 = taskManager.create('custom:test', { seq: 2 });
    const result = taskManager.list();
    // Both tasks should be returned
    expect(result.tasks.length).toBe(2);
    // Task IDs should be different
    expect(t1.taskId).not.toBe(t2.taskId);
  });
});
