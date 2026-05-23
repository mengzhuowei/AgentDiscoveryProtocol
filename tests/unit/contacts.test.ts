import { ContactStore } from '../../src/contacts';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TrustStore } from '../../src/trust-store';
import { generateKeyPair, buildAgentId } from '../../src/index';
import { encodeBase64URL } from '../../src/crypto';

describe('ContactStore', () => {
  let tempDir: string;
  let tempPath: string;
  let store: ContactStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adp-contacts-test'));
    tempPath = path.join(tempDir, 'contacts.json');
    store = new ContactStore(tempPath);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  test('set and get routes', () => {
    store.set('adp://test@local/agent', {
      routes: [{ type: 'direct', address: '192.168.1.1' }],
    });

    const routes = store.getRoutes('adp://test@local/agent');
    expect(routes).toEqual([{ type: 'direct', address: '192.168.1.1' }]);
  });

  test('save and load', async () => {
    store.set('adp://test@local/agent', {
      routes: [{ type: 'relay', relay: 'https://relay.example.com' }],
    });
    await store.save();

    const newStore = new ContactStore(tempPath);
    await newStore.load();

    expect(newStore.getRoutes('adp://test@local/agent')).not.toBeNull();
  });

  test('pinTrustedKeys', () => {
    const keys = generateKeyPair();
    const agentId = buildAgentId(keys.publicKey, 'local', 'agent');
    const trustStore = new TrustStore(':memory:');

    store.set(agentId, {
      routes: [],
      trust: 'pinned',
      public_key: encodeBase64URL(keys.publicKey),
    });

    const result = store.pinTrustedKeys(trustStore);
    expect(result.pinned).toEqual([agentId]);
    expect(trustStore.has(agentId)).toBe(true);
  });
});
