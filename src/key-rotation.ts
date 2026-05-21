import { generateKeyPair, signEnvelope } from './crypto';
import { buildAgentId } from './agent-id';
import { buildEnvelope, Envelope } from './envelope';
import { canonicalize } from './canonical';
import { Manifest, createManifest } from './manifest';

export interface KeyRotationResult {
  oldAgentId: string;
  newAgentId: string;
  newSecretKey: Uint8Array;
  newManifest: Manifest;
  rotationEnvelope: Envelope;
}

export interface KeyRotationParams {
  oldSecretKey: Uint8Array;
  oldAgentId: string;
  displayName: string;
  capabilities: (string | any)[];
  routes: any[];
  reason?: string;
  namespace?: string;
  agentName?: string;
}

export async function rotateKeys(params: KeyRotationParams): Promise<KeyRotationResult> {
  const { oldSecretKey, oldAgentId, displayName, capabilities, routes, reason = 'scheduled' } = params;
  
  const namespace = extractNamespace(oldAgentId);
  const agentName = extractAgentName(oldAgentId);
  
  const newKeyPair = await generateKeyPair();
  const newAgentId = buildAgentId(newKeyPair.publicKey, namespace, agentName);
  
  const newManifest = createManifest(newAgentId, displayName, capabilities, routes);
  
  const unsignedRotateEnvelope = buildEnvelope(
    oldAgentId,
    newAgentId,
    'adp:key.rotate',
    { new_agent_id: newAgentId, reason }
  );
  
  const rotationEnvelope = signEnvelope(unsignedRotateEnvelope, oldSecretKey, canonicalize) as unknown as Envelope;
  
  return {
    oldAgentId,
    newAgentId,
    newSecretKey: newKeyPair.secretKey,
    newManifest,
    rotationEnvelope,
  };
}

export function buildRegistryUpdate(
  initialId: string,
  newAgentId: string,
  newManifest: Manifest,
  routes: any[],
  rotationEnvelope: Envelope
) {
  return {
    agent_id: newAgentId,
    manifest: newManifest,
    routes: routes,
    rotation: rotationEnvelope,
  };
}

function extractNamespace(agentId: string): string {
  const parts = agentId.split('@');
  if (parts.length < 2) return 'local';
  const afterAt = parts[1];
  const namespaceParts = afterAt.split('/');
  return namespaceParts[0];
}

function extractAgentName(agentId: string): string {
  const parts = agentId.split('@');
  if (parts.length < 2) return 'agent';
  const afterAt = parts[1];
  const namespaceParts = afterAt.split('/');
  return namespaceParts.length > 1 ? namespaceParts[1] : 'agent';
}

export function buildKeyRotateMessage(
  fromAgentId: string,
  toAgentId: string,
  newAgentId: string,
  secretKey: Uint8Array,
  reason?: string
): Envelope {
  const unsigned = buildEnvelope(
    fromAgentId,
    toAgentId,
    'adp:key.rotate',
    { new_agent_id: newAgentId, reason }
  );
  
  return signEnvelope(unsigned, secretKey, canonicalize) as unknown as Envelope;
}
