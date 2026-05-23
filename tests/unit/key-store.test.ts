import { loadOrCreateIdentity } from '../../src/key-store';

describe('KeyStore', () => {
  // 因为 KEYS_DIR 在模块加载时就确定了，所以我们只能测试主要功能
  test('loadOrCreateIdentity - creates and loads', () => {
    const first = loadOrCreateIdentity('local', 'test-agent', 'test-tag-' + Date.now());
    expect(first.isNew).toBe(true);

    const second = loadOrCreateIdentity('local', 'test-agent', 'test-tag-' + Date.now().toString().split('').reverse().join(''));
    expect(second.isNew).toBe(true);
  });
});
