import { MessageVerifier, buildEnvelope, generateMessageId } from '../../src/envelope';
import { TrustStore } from '../../src/trust-store';
import { signEnvelope } from '../../src/crypto';
import { canonicalize } from '../../src/canonical';
import { generateKeyPair, buildAgentId } from '../../src/index';

describe('MessageVerifier', () => {
  let aliceKeys: ReturnType<typeof generateKeyPair>;
  let bobKeys: ReturnType<typeof generateKeyPair>;
  let aliceId: string;
  let bobId: string;
  let trustStore: TrustStore;
  let verifier: MessageVerifier;

  beforeEach(() => {
    aliceKeys = generateKeyPair();
    bobKeys = generateKeyPair();
    aliceId = buildAgentId(aliceKeys.publicKey, 'local', 'alice');
    bobId = buildAgentId(bobKeys.publicKey, 'local', 'bob');
    trustStore = new TrustStore(':memory:');
    verifier = new MessageVerifier(trustStore, { tofuEnabled: true });
  });

  test('首次消息 - TOFU 自动 pin', async () => {
    const unsignedEnvelope = buildEnvelope(aliceId, bobId, 'adp:ping', { data: 'hello' });
    const signedEnvelope = signEnvelope(unsignedEnvelope, aliceKeys.secretKey, canonicalize);

    const result = await verifier.verify(signedEnvelope as any);

    expect(result.valid).toBe(true);
    expect(trustStore.has(aliceId)).toBe(true);
  });

  test('TOFU 禁用时拒绝未知发送者', async () => {
    const strictStore = new TrustStore(':memory:');
    const strictVerifier = new MessageVerifier(strictStore, { tofuEnabled: false });

    const unsignedEnvelope = buildEnvelope(aliceId, bobId, 'adp:ping', { data: 'hello' });
    const signedEnvelope = signEnvelope(unsignedEnvelope, aliceKeys.secretKey, canonicalize);

    const result = await strictVerifier.verify(signedEnvelope as any);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('TRUST_NOT_ESTABLISHED');
    expect(strictStore.has(aliceId)).toBe(false);
  });

  test('签名验证失败 - 错误签名', async () => {
    const unsignedEnvelope = buildEnvelope(aliceId, bobId, 'adp:ping', { data: 'hello' });
    const signedEnvelope = signEnvelope(unsignedEnvelope, aliceKeys.secretKey, canonicalize) as any;
    
    // 篡改签名
    const tamperedEnvelope = { ...signedEnvelope, sig: (signedEnvelope.sig as string).slice(0, -4) + 'abcd' };
    
    const result = await verifier.verify(tamperedEnvelope as any);
    
    expect(result.valid).toBe(false);
    expect(result.error).toBe('INVALID_SIGNATURE');
  });

  test('信任冲突检测', async () => {
    // 首次 pin Alice 的公钥
    trustStore.pin(aliceId, bobKeys.publicKey, 'tofu');
    
    // 现在用另一个公钥签名
    const unsignedEnvelope = buildEnvelope(aliceId, bobId, 'adp:ping', { data: 'hello' });
    const signedEnvelope = signEnvelope(unsignedEnvelope, aliceKeys.secretKey, canonicalize);
    
    const result = await verifier.verify(signedEnvelope as any);
    
    expect(result.valid).toBe(false);
    expect(result.error).toBe('TRUST_CONFLICT');
  });

  test('时间戳检查 - 过期消息', async () => {
    const unsignedEnvelope = buildEnvelope(aliceId, bobId, 'adp:ping', { data: 'hello' });
    const signedEnvelope = signEnvelope(unsignedEnvelope, aliceKeys.secretKey, canonicalize);
    
    // 改时间戳为 10 分钟前
    const oldTimestamp = new Date(Date.now() - 600_000).toISOString();
    const expiredEnvelope = { ...signedEnvelope, timestamp: oldTimestamp };
    const resignedEnvelope = signEnvelope(expiredEnvelope, aliceKeys.secretKey, canonicalize);
    
    const result = await verifier.verify(resignedEnvelope as any);
    
    expect(result.valid).toBe(false);
    expect(result.error).toBe('INVALID_PARAMS');
  });

  test('缺少签名', async () => {
    const unsignedEnvelope = buildEnvelope(aliceId, bobId, 'adp:ping', { data: 'hello' });
    
    const result = await verifier.verify(unsignedEnvelope as any);
    
    expect(result.valid).toBe(false);
    expect(result.error).toBe('INVALID_SIGNATURE');
  });

  test('无效签名长度', async () => {
    const unsignedEnvelope = buildEnvelope(aliceId, bobId, 'adp:ping', { data: 'hello' });
    const signedEnvelope = { ...unsignedEnvelope, sig: 'too-short' };
    
    const result = await verifier.verify(signedEnvelope as any);
    
    expect(result.valid).toBe(false);
    expect(result.error).toBe('INVALID_SIGNATURE');
  });

  test('验证成功更新上次验证时间', async () => {
    const unsignedEnvelope = buildEnvelope(aliceId, bobId, 'adp:ping', { data: 'hello' });
    const signedEnvelope = signEnvelope(unsignedEnvelope, aliceKeys.secretKey, canonicalize);
    
    // 第一次验证
    await verifier.verify(signedEnvelope as any);
    const firstVerified = trustStore.getRecord(aliceId)?.last_verified;
    
    // 等待一下
    await new Promise(r => setTimeout(r, 10));
    
    // 第二次验证
    await verifier.verify(signedEnvelope as any);
    const secondVerified = trustStore.getRecord(aliceId)?.last_verified;
    
    expect(new Date(secondVerified!).getTime()).toBeGreaterThan(new Date(firstVerified!).getTime());
  });
});
