import { WebSocket } from 'ws';
import { Envelope } from './envelope';
import { signEnvelope } from './crypto';
import { canonicalize } from './canonical';
import { generateMessageId } from './envelope';
import { ActionHandler } from './gateway';

export function createEchoHandler(agentId: string, secretKey: Uint8Array): ActionHandler {
  return async (ws: WebSocket, envelope: Envelope) => {
    const reply = signEnvelope({
      protocol: 'adp/0.2',
      id: generateMessageId(),
      from: agentId,
      to: envelope.from,
      action: 'custom:echo',
      params: envelope.params,
      timestamp: new Date().toISOString(),
    }, secretKey, canonicalize);

    ws.send(JSON.stringify(reply));
  };
}

export function createChatHandler(
  agentId: string,
  secretKey: Uint8Array,
  onMessage?: (from: string, text: string) => void
): ActionHandler {
  return async (ws: WebSocket, envelope: Envelope) => {
    const params = envelope.params as { text?: string };
    const text = params.text || '';

    onMessage?.(envelope.from, text);

    const reply = signEnvelope({
      protocol: 'adp/0.2',
      id: generateMessageId(),
      from: agentId,
      to: envelope.from,
      action: 'custom:chat',
      params: { ok: true },
      timestamp: new Date().toISOString(),
    }, secretKey, canonicalize);

    ws.send(JSON.stringify(reply));
  };
}
