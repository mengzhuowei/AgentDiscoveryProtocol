import { sign, encodeBase64URL, verify, decodeBase64URL } from './crypto';
import { canonicalize } from './canonical';
import { WebhookConfig } from './config';
import { getLogger } from './logger';

export type WebhookEvent = 'task.completed' | 'task.failed' | 'task.progress';

export interface WebhookPayload<T = unknown> {
  event: WebhookEvent;
  task_id: string;
  agent_id: string;
  timestamp: string;
  signature: string;
  data: T;
}

export interface TaskResult<T = unknown> {
  result?: T;
  error?: {
    code: string;
    message: string;
  };
  progress?: {
    current: number;
    total: number;
    message: string;
  };
}

export class WebhookClient {
  private logger = getLogger();

  constructor(private config: WebhookConfig) {
    if (!config.url || !config.secret) {
      throw new Error('Webhook URL and secret are required');
    }
  }

  async sendWebhook<T = unknown>(
    event: WebhookEvent,
    taskId: string,
    agentId: string,
    data: TaskResult<T>,
    secretKey: Uint8Array
  ): Promise<void> {
    const payload: WebhookPayload<TaskResult<T>> = {
      event,
      task_id: taskId,
      agent_id: agentId,
      timestamp: new Date().toISOString(),
      signature: '',
      data
    };

    payload.signature = this.signPayload(payload, secretKey);

    const maxAttempts = this.config.retry?.maxAttempts || 3;
    const backoffMs = this.config.retry?.backoffMs || 1000;
    const timeout = this.config.timeout || 30000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), timeout);

        const response = await fetch(this.config.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': payload.signature,
            'X-Webhook-Timestamp': payload.timestamp,
            'X-Webhook-Event': event,
            'X-Webhook-Task-Id': taskId
          },
          body: JSON.stringify(payload),
          signal: abortController.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          this.logger.info(`Webhook sent successfully: ${event} (task: ${taskId})`);
          return;
        }

        const errorText = await response.text();
        this.logger.warn(
          `Webhook failed (attempt ${attempt}/${maxAttempts}): ${response.status} - ${errorText}`
        );

      } catch (error) {
        this.logger.warn(
          `Webhook request failed (attempt ${attempt}/${maxAttempts}): ${error}`
        );
      }

      if (attempt < maxAttempts) {
        const delay = backoffMs * Math.pow(2, attempt - 1);
        this.logger.info(`Retrying webhook in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error(`Webhook failed after ${maxAttempts} attempts`);
  }

  private signPayload(payload: Omit<WebhookPayload, 'signature'>, secretKey: Uint8Array): string {
    const canonical = canonicalize(payload);
    const messageBytes = new TextEncoder().encode(canonical);
    const signatureBytes = sign(secretKey, messageBytes);
    return encodeBase64URL(signatureBytes);
  }

  static verifyWebhookSignature(
    payload: WebhookPayload,
    publicKey: Uint8Array
  ): boolean {
    const { signature, ...unsigned } = payload;
    const canonical = canonicalize(unsigned);
    const messageBytes = new TextEncoder().encode(canonical);
    const signatureBytes = decodeBase64URL(signature);
    return verify(publicKey, messageBytes, signatureBytes);
  }
}
