import { generateKeyPair, signEnvelope } from './crypto';
import { buildAgentId, parseAgentId } from './agent-id';
import { buildEnvelope, Envelope } from './envelope';
import { canonicalize } from './canonical';
import { Manifest, Capability, Route, createManifest } from './manifest';

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
  capabilities: (string | Capability)[];
  routes: Route[];
  reason?: string;
  namespace?: string;
  agentName?: string;
}

export function rotateKeys(params: KeyRotationParams): KeyRotationResult {
  const { oldSecretKey, oldAgentId, displayName, capabilities, routes, reason = 'scheduled' } = params;
  
  const parsed = parseAgentId(oldAgentId);
  const namespace = params.namespace || parsed.namespace;
  const agentName = params.agentName || parsed.agentName;
  
  const newKeyPair = generateKeyPair();
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
  routes: Route[],
  rotationEnvelope: Envelope
) {
  return {
    agent_id: newAgentId,
    manifest: newManifest,
    routes: routes,
    rotation: rotationEnvelope,
  };
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
