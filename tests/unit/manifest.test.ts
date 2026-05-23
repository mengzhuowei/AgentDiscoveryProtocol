import { createManifest, hasCapability, getCapability } from '../../src/manifest';
import { generateKeyPair, buildAgentId } from '../../src/index';

describe('Manifest', () => {
  test('createManifest', () => {
    const keys = generateKeyPair();
    const agentId = buildAgentId(keys.publicKey, 'local', 'test');

    const manifest = createManifest(agentId, 'Test Agent', ['adp:ping'], [], {
      description: 'A test agent',
    });

    expect(manifest.agent_id).toBe(agentId);
    expect(manifest.display_name).toBe('Test Agent');
    expect(manifest.capabilities).toEqual(['adp:ping']);
  });

  test('hasCapability - string capability', () => {
    const keys = generateKeyPair();
    const agentId = buildAgentId(keys.publicKey, 'local', 'test');
    const manifest = createManifest(agentId, 'Test', ['adp:ping', 'adp:info'], []);

    expect(hasCapability(manifest, 'adp:ping')).toBe(true);
    expect(hasCapability(manifest, 'missing')).toBe(false);
  });

  test('hasCapability - object capability', () => {
    const keys = generateKeyPair();
    const agentId = buildAgentId(keys.publicKey, 'local', 'test');
    const manifest = createManifest(
      agentId,
      'Test',
      [
        'adp:ping',
        {
          capability: 'custom:video',
          description: 'Video generation',
        },
      ],
      []
    );

    expect(hasCapability(manifest, 'adp:ping')).toBe(true);
    expect(hasCapability(manifest, 'custom:video')).toBe(true);
  });

  test('getCapability', () => {
    const keys = generateKeyPair();
    const agentId = buildAgentId(keys.publicKey, 'local', 'test');
    const manifest = createManifest(
      agentId,
      'Test',
      [
        {
          capability: 'custom:video',
          description: 'Video generation',
        },
      ],
      []
    );

    const cap = getCapability(manifest, 'custom:video');
    expect(cap?.description).toBe('Video generation');
  });
});
