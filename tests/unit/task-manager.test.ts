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
});
