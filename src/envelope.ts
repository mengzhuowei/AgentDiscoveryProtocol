import { verify, decodeBase64URL } from './crypto';
import { canonicalize } from './canonical';
import { extractPublicKey } from './agent-id';
import { TrustStore } from './trust-store';

export interface Envelope {
  protocol: string;
  id: string;
  from: string;
  to: string;
  action: string;
  params: unknown;
  timestamp: string;
  sig: string;
  reply_to?: string;
  error?: { code: string; message: string; data?: unknown };
  trace_id?: string;
  span_id?: string;
  encoding?: string;
  expires_at?: string;
}

export interface VerificationResult {
  valid: boolean;
  error?: string;
  message?: string;
}

const TIMESTAMP_TOLERANCE_MS = 300_000;

export class MessageVerifier {
  constructor(private trustStore: TrustStore) {}

  async verify(envelope: Envelope): Promise<VerificationResult> {
    if (!envelope.sig) {
      return { valid: false, error: 'INVALID_SIGNATURE', message: 'Signature missing' };
    }

    const sigBytes = decodeBase64URL(envelope.sig);
    if (sigBytes.length !== 64) {
      return { valid: false, error: 'INVALID_SIGNATURE', message: 'Invalid signature length' };
    }

    const timestamp = new Date(envelope.timestamp).getTime();
    const now = Date.now();
    if (Math.abs(now - timestamp) > TIMESTAMP_TOLERANCE_MS) {
      return { valid: false, error: 'INVALID_PARAMS', message: 'Timestamp too old or in future' };
    }

    const publicKey = extractPublicKey(envelope.from);

    if (!this.trustStore.has(envelope.from)) {
      this.trustStore.pin(envelope.from, publicKey, 'tofu');
    }

    const { sig, ...unsigned } = envelope;
    const canonical = canonicalize(unsigned);
    const messageBytes = new TextEncoder().encode(canonical);

    const isValid = verify(publicKey, messageBytes, sigBytes);

    if (isValid) {
      this.trustStore.updateLastVerified(envelope.from);
      return { valid: true };
    }

    return { valid: false, error: 'INVALID_SIGNATURE', message: 'Signature verification failed' };
  }
}

export function generateMessageId(): string {
  return 'msg_' + Math.random().toString(36).slice(2, 10);
}

export function buildEnvelope(
  from: string,
  to: string,
  action: string,
  params: unknown = {},
  options?: {
    reply_to?: string;
    error?: { code: string; message: string; data?: unknown };
    trace_id?: string;
    span_id?: string;
  }
): Omit<Envelope, 'sig'> {
  return {
    protocol: 'adp/0.2',
    id: generateMessageId(),
    from,
    to,
    action,
    params,
    timestamp: new Date().toISOString(),
    ...options,
  };
}
