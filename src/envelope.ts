import { verify, decodeBase64URL } from './crypto';
import { canonicalize } from './canonical';
import { extractPublicKey } from './agent-id';
import { TrustStore } from './trust-store';
import { randomBytes } from 'crypto';
import { getLogger } from './logger';

export const MESSAGE_SIZE_LIMIT = 1024 * 1024;

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

export interface VerifierOptions {
  /** Enable TOFU (Trust On First Use) — auto-trusts unknown senders on first verified message.
   *  Default: false. Enable only in development or when you understand the risk. */
  tofuEnabled?: boolean;
  /** Called when a previously-unknown agent is encountered. */
  onNewAgent?: (agentId: string) => void;
  /** Max clock skew tolerance in milliseconds. Default: 300_000 (5 min). */
  timestampToleranceMs?: number;
}

export class MessageVerifier {
  private tofuEnabled: boolean;
  private onNewAgent?: (agentId: string) => void;
  private timestampToleranceMs: number;

  constructor(
    private trustStore: TrustStore,
    options: VerifierOptions = {},
  ) {
    this.tofuEnabled = options.tofuEnabled ?? false;
    this.onNewAgent = options.onNewAgent;
    this.timestampToleranceMs = options.timestampToleranceMs ?? TIMESTAMP_TOLERANCE_MS;
  }

  async verify(envelope: Envelope): Promise<VerificationResult> {
    if (!envelope.sig) {
      return { valid: false, error: 'INVALID_SIGNATURE', message: 'Signature missing' };
    }

    const sigBytes = decodeBase64URL(envelope.sig);
    if (sigBytes.length !== 64) {
      return { valid: false, error: 'INVALID_SIGNATURE', message: 'Invalid signature length' };
    }

    const timestamp = new Date(envelope.timestamp).getTime();
    if (isNaN(timestamp)) {
      return { valid: false, error: 'INVALID_PARAMS', message: 'Invalid timestamp format' };
    }
    const now = Date.now();
    if (Math.abs(now - timestamp) > this.timestampToleranceMs) {
      return { valid: false, error: 'INVALID_PARAMS', message: 'Timestamp too old or in future' };
    }

    const publicKey = (() => {
      try {
        return extractPublicKey(envelope.from);
      } catch {
        return null;
      }
    })();
    if (!publicKey) {
      return { valid: false, error: 'INVALID_PARAMS', message: 'Invalid sender agent ID format' };
    }

    const { sig, ...unsigned } = envelope;
    const canonical = canonicalize(unsigned);
    const messageBytes = new TextEncoder().encode(canonical);

    const isValid = verify(publicKey, messageBytes, sigBytes);

    if (!isValid) {
      return { valid: false, error: 'INVALID_SIGNATURE', message: 'Signature verification failed' };
    }

    if (this.trustStore.has(envelope.from)) {
      if (this.trustStore.hasConflict(envelope.from, publicKey)) {
        return { valid: false, error: 'TRUST_CONFLICT', message: 'Agent public key does not match trusted key' };
      }
    } else {
      if (this.tofuEnabled) {
        this.trustStore.pin(envelope.from, publicKey, 'tofu');
        this.onNewAgent?.(envelope.from);
      } else {
        return {
          valid: false,
          error: 'TRUST_NOT_ESTABLISHED',
          message: `Agent ${envelope.from} is not in trust store. TOFU is disabled — pin the agent first.`,
        };
      }
    }
    this.trustStore.updateLastVerified(envelope.from);
    this.trustStore.save().catch(err => {
      getLogger().warn('[ADP MessageVerifier] Failed to save trust store:', err);
    });
    return { valid: true };
  }
}

export function generateMessageId(): string {
  return 'msg_' + randomBytes(8).toString('base64url');
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
