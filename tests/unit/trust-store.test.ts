import { TrustStore } from '../../src/trust-store';
import { generateKeyPair, encodeBase64URL } from '../../src/index';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('TrustStore', () => {
  let tempDir: string;
  let tempFilePath: string;
  let trustStore: TrustStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adp-test'));
    tempFilePath = path.join(tempDir, 'trust_store.json');
    trustStore = new TrustStore(tempFilePath);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  test('pin 一个新的 agent', () => {
    const keys = generateKeyPair();
    const agentId = 'adp://test@local/test';
    
    trustStore.pin(agentId, keys.publicKey, 'tofu');
    
    expect(trustStore.has(agentId)).toBe(true);
    expect(trustStore.getPublicKey(agentId)).toEqual(keys.publicKey);
  });

  test('检测信任冲突', () => {
    const keys1 = generateKeyPair();
    const keys2 = generateKeyPair();
    const agentId = 'adp://test@local/test';
    
    trustStore.pin(agentId, keys1.publicKey, 'tofu');
    
    expect(trustStore.hasConflict(agentId, keys2.publicKey)).toBe(true);
    expect(trustStore.hasConflict(agentId, keys1.publicKey)).toBe(false);
  });

  test('添加密钥轮换', () => {
    const oldKeys = generateKeyPair();
    const newKeys = generateKeyPair();
    const oldAgentId = 'adp://old@local/test';
    const newAgentId = 'adp://new@local/test';
    
    trustStore.pin(oldAgentId, oldKeys.publicKey, 'tofu');
    trustStore.addRotation(oldAgentId, newAgentId, newKeys.publicKey);
    
    // getPublicKey 应该返回新的公钥
    expect(trustStore.getPublicKey(oldAgentId)).toEqual(newKeys.publicKey);
    expect(trustStore.getPublicKey(newAgentId)).toEqual(newKeys.publicKey);
  });

  test('updateLastVerified 更新时间', () => {
    const keys = generateKeyPair();
    const agentId = 'adp://test@local/test';
    
    trustStore.pin(agentId, keys.publicKey, 'tofu');
    
    // 等待一下
    trustStore.updateLastVerified(agentId);
    const after = new Date();
    
    const secondVerified = trustStore.getRecord(agentId)?.last_verified;
    
    const secondVerifiedDate = new Date(secondVerified!);
    expect(secondVerifiedDate.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test('保存和加载', async () => {
    const keys = generateKeyPair();
    const agentId = 'adp://test@local/test';
    
    trustStore.pin(agentId, keys.publicKey, 'tofu');
    await trustStore.save();
    
    // 创建新的 TrustStore 加载
    const newStore = new TrustStore(tempFilePath);
    await newStore.load();
    
    expect(newStore.has(agentId)).toBe(true);
    expect(newStore.getPublicKey(agentId)).toEqual(keys.publicKey);
  });
});
