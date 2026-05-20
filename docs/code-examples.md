# 代码示例

**协议版本：** `adp/0.2`

本文件提供 ADP 核心模块的参考实现代码示例。示例使用 TypeScript 和 Python 两种语言。

---

## 1. Base64URL 编解码

### TypeScript

```typescript
const BASE64_URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function encodeBase64URL(data: Uint8Array): string {
  let result = '';
  for (let i = 0; i < data.length; i += 3) {
    const b1 = data[i];
    const b2 = i + 1 < data.length ? data[i + 1] : 0;
    const b3 = i + 2 < data.length ? data[i + 2] : 0;

    result += BASE64_URL_CHARS[b1 >> 2];
    result += BASE64_URL_CHARS[((b1 & 0x03) << 4) | (b2 >> 4)];
    result += i + 1 < data.length ? BASE64_URL_CHARS[((b2 & 0x0f) << 2) | (b3 >> 6)] : '=';
    result += i + 2 < data.length ? BASE64_URL_CHARS[b3 & 0x3f] : '=';
  }
  return result.replace(/=/g, '');
}

export function decodeBase64URL(data: string): Uint8Array {
  const padded = data.padEnd(data.length + (4 - data.length % 4) % 4, '=');
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
```

### Python

```python
import base64

def encode_base64_url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')

def decode_base64_url(data: str) -> bytes:
    padded = data + '=' * (4 - len(data) % 4)
    return base64.urlsafe_b64decode(padded.replace('-', '+').replace('_', '/'))
```

---

## 2. ADP Canonical JSON

### TypeScript

```typescript
function sortObjectKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  if (obj && typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj as Record<string, unknown>).sort((a, b) =>
      a.localeCompare(b, 'en', { sensitivity: 'base' })
    );
    for (const key of keys) {
      sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return obj;
}

export function canonicalize(obj: unknown): string {
  const sorted = sortObjectKeys(obj);
  return JSON.stringify(sorted);
}
```

### Python

```python
import json

def canonicalize(obj) -> str:
    return json.dumps(obj, separators=(',', ':'), sort_keys=True, ensure_ascii=False)
```

---

## 3. 签名与验签

### TypeScript (使用 tweetnacl)

```typescript
import { nacl } from 'tweetnacl';
import { encodeBase64URL, decodeBase64URL } from './base64';
import { canonicalize } from './canonical';

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export function generateKeyPair(): KeyPair {
  return nacl.sign.keyPair();
}

export function sign(secretKey: Uint8Array, message: Uint8Array): Uint8Array {
  return nacl.sign.detached(message, secretKey);
}

export function verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  return nacl.sign.detached.verify(message, signature, publicKey);
}

export async function signEnvelope(
  envelope: Record<string, unknown>,
  secretKey: Uint8Array
): Promise<Record<string, unknown>> {
  const { sig, ...unsigned } = envelope;
  const canonical = canonicalize(unsigned);
  const messageBytes = new TextEncoder().encode(canonical);
  const signatureBytes = sign(secretKey, messageBytes);
  return { ...unsigned, sig: encodeBase64URL(signatureBytes) };
}
```

### Python (使用 PyNaCl)

```python
from nacl.signing import SigningKey
from nacl.encoding import RawEncoder
from .canonical import canonicalize
from .base64 import encode_base64_url, decode_base64_url

class KeyPair:
    def __init__(self, secret_key: bytes):
        self._signing_key = SigningKey(secret_key)
        self.public_key = bytes(self._signing_key.verify_key)
        self.secret_key = secret_key

    @classmethod
    def generate(cls) -> 'KeyPair':
        return cls(SigningKey.generate().encode(RawEncoder()))

def sign(secret_key: bytes, message: bytes) -> bytes:
    signing_key = SigningKey(secret_key, encoder=RawEncoder)
    return signing_key.sign(message, encoder=RawEncoder)

def verify(public_key: bytes, message: bytes, signature: bytes) -> bool:
    try:
        verify_key = SigningKey(public_key, encoder=RawEncoder).verify_key
        verify_key.verify(message, signature, encoder=RawEncoder)
        return True
    except Exception:
        return False

def sign_envelope(envelope: dict, secret_key: bytes) -> dict:
    unsigned = {k: v for k, v in envelope.items() if k != 'sig'}
    canonical = canonicalize(unsigned)
    message_bytes = canonical.encode('utf-8')
    signature_bytes = sign(secret_key, message_bytes)
    return {**unsigned, 'sig': encode_base64_url(signature_bytes)}
```

---

## 4. Agent ID 解析

### TypeScript

```typescript
export interface ParsedAgentId {
  publicKey: Uint8Array;
  namespace: string;
  agentName: string;
}

export function parseAgentId(agentId: string): ParsedAgentId {
  const match = agentId.match(/^adp:\/\/([^@]+)@([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error('Invalid Agent ID format');
  }

  const [, pubkeyB64URL, namespace, agentName] = match;

  if (pubkeyB64URL.length !== 43) {
    throw new Error('Invalid public key length');
  }

  const publicKey = decodeBase64URL(pubkeyB64URL);
  if (publicKey.length !== 32) {
    throw new Error('Invalid public key: must be 32 bytes');
  }

  return { publicKey, namespace, agentName };
}

export function buildAgentId(publicKey: Uint8Array, namespace: string, agentName: string): string {
  const pubkeyB64URL = encodeBase64URL(publicKey);
  return `adp://${pubkeyB64URL}@${namespace}/${agentName}`;
}

export function extractPublicKey(agentId: string): Uint8Array {
  return parseAgentId(agentId).publicKey;
}
```

### Python

```python
import re
from .base64 import decode_base64_url, encode_base64_url

@dataclass
class ParsedAgentId:
    public_key: bytes
    namespace: str
    agent_name: str

def parse_agent_id(agent_id: str) -> ParsedAgentId:
    match = re.match(r'^adp:\/\/([^@]+)@([^/]+)\/(.+)$', agent_id)
    if not match:
        raise ValueError('Invalid Agent ID format')

    pubkey_b64url, namespace, agent_name = match.groups()

    if len(pubkey_b64url) != 43:
        raise ValueError('Invalid public key length')

    public_key = decode_base64_url(pubkey_b64url)
    if len(public_key) != 32:
        raise ValueError('Invalid public key: must be 32 bytes')

    return ParsedAgentId(public_key=public_key, namespace=namespace, agent_name=agent_name)

def build_agent_id(public_key: bytes, namespace: str, agent_name: str) -> str:
    pubkey_b64url = encode_base64_url(public_key)
    return f'adp://{pubkey_b64url}@{namespace}/{agent_name}'

def extract_public_key(agent_id: str) -> bytes:
    return parse_agent_id(agent_id).public_key
```

---

## 5. 消息验证流程

### TypeScript

```typescript
import { verify as naclVerify } from 'tweetnacl';
import { decodeBase64URL } from './base64';
import { canonicalize } from './canonical';
import { TrustStore } from './trust-store';

interface Envelope {
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
}

const TIMESTAMP_TOLERANCE_MS = 300_000; // 300 秒

export class MessageVerifier {
  constructor(private trustStore: TrustStore) {}

  async verify(envelope: Envelope): Promise<VerificationResult> {
    if (!envelope.sig) {
      return { valid: false, error: 'INVALID_SIGNATURE' };
    }

    const sigBytes = decodeBase64URL(envelope.sig);
    if (sigBytes.length !== 64) {
      return { valid: false, error: 'INVALID_SIGNATURE' };
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

    const isValid = naclVerify(messageBytes, sigBytes, publicKey);

    if (isValid) {
      this.trustStore.updateLastVerified(envelope.from);
      return { valid: true };
    }

    return { valid: false, error: 'INVALID_SIGNATURE' };
  }
}

interface VerificationResult {
  valid: boolean;
  error?: string;
  message?: string;
}
```

### Python

```python
from nacl.signing import VerifyKey
from nacl.encoding import RawEncoder
from datetime import datetime, timezone
from .base64 import decode_base64_url
from .canonical import canonicalize
from .agent_id import extract_public_key

TIMESTAMP_TOLERANCE_MS = 300_000

@dataclass
class VerificationResult:
    valid: bool
    error: str | None = None
    message: str | None = None

class MessageVerifier:
    def __init__(self, trust_store):
        self.trust_store = trust_store

    def verify(self, envelope: dict) -> VerificationResult:
        if 'sig' not in envelope:
            return VerificationResult(valid=False, error='INVALID_SIGNATURE')

        sig_bytes = decode_base64_url(envelope['sig'])
        if len(sig_bytes) != 64:
            return VerificationResult(valid=False, error='INVALID_SIGNATURE')

        timestamp = datetime.fromisoformat(envelope['timestamp'].replace('Z', '+00:00'))
        now = datetime.now(timezone.utc)
        age_ms = abs((now - timestamp).total_seconds()) * 1000

        if age_ms > TIMESTAMP_TOLERANCE_MS:
            return VerificationResult(
                valid=False, error='INVALID_PARAMS', message='Timestamp too old or in future'
            )

        public_key = extract_public_key(envelope['from'])

        if not self.trust_store.has(envelope['from']):
            self.trust_store.pin(envelope['from'], public_key, 'tofu')

        unsigned = {k: v for k, v in envelope.items() if k != 'sig'}
        canonical = canonicalize(unsigned)
        message_bytes = canonical.encode('utf-8')

        try:
            verify_key = VerifyKey(public_key, encoder=RawEncoder)
            verify_key.verify(message_bytes, sig_bytes, encoder=RawEncoder)
            self.trust_store.update_last_verified(envelope['from'])
            return VerificationResult(valid=True)
        except Exception:
            return VerificationResult(valid=False, error='INVALID_SIGNATURE')
```

---

## 6. Trust Store

### TypeScript

```typescript
import { promises as fs } from 'fs';
import { extractPublicKey } from './agent-id';

interface TrustRecord {
  public_key: string;
  first_seen: string;
  last_verified: string;
  origin: 'tofu' | 'pinned' | 'rotation';
  verified_by: string[];
  superseded_by: string | null;
}

interface TrustStoreData {
  [agentId: string]: TrustRecord;
}

export class TrustStore {
  private data: TrustStoreData = {};
  private filePath: string;

  constructor(filePath: string = '~/.adp/trust_store.json') {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      this.data = JSON.parse(content);
    } catch {
      this.data = {};
    }
  }

  async save(): Promise<void> {
    await fs.mkdir(this.filePath.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2));
  }

  has(agentId: string): boolean {
    return agentId in this.data;
  }

  pin(agentId: string, publicKey: Uint8Array, origin: TrustRecord['origin'], verifiedBy: string[] = ['tofu_single']): void {
    this.data[agentId] = {
      public_key: encodeBase64URL(publicKey),
      first_seen: new Date().toISOString(),
      last_verified: new Date().toISOString(),
      origin,
      verified_by: verifiedBy,
      superseded_by: null,
    };
  }

  getPublicKey(agentId: string): Uint8Array | null {
    const record = this.data[agentId];
    if (!record) return null;

    if (record.superseded_by) {
      return this.getPublicKey(record.superseded_by);
    }

    return decodeBase64URL(record.public_key);
  }

  updateLastVerified(agentId: string): void {
    if (this.data[agentId]) {
      this.data[agentId].last_verified = new Date().toISOString();
    }
  }

  addRotation(oldAgentId: string, newAgentId: string, publicKey: Uint8Array): void {
    if (this.data[oldAgentId]) {
      this.data[oldAgentId].superseded_by = newAgentId;
    }

    this.data[newAgentId] = {
      public_key: encodeBase64URL(publicKey),
      first_seen: new Date().toISOString(),
      last_verified: new Date().toISOString(),
      origin: 'rotation',
      verified_by: ['rotation'],
      superseded_by: null,
    };
  }

  hasConflict(agentId: string, publicKey: Uint8Array): boolean {
    const existing = this.getPublicKey(agentId);
    if (!existing) return false;
    return Buffer.from(existing).equals(Buffer.from(publicKey));
  }
}
```

### Python

```python
import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from .base64 import encode_base64_url, decode_base64_url
from .agent_id import extract_public_key

@dataclass
class TrustRecord:
    public_key: str
    first_seen: str
    last_verified: str
    origin: str
    verified_by: list[str]
    superseded_by: str | None

class TrustStore:
    def __init__(self, file_path: str = '~/.adp/trust_store.json'):
        self.file_path = os.path.expanduser(file_path)
        self.data: dict[str, TrustRecord] = {}

    def load(self) -> None:
        try:
            with open(self.file_path, 'r') as f:
                raw = json.load(f)
                self.data = {k: TrustRecord(**v) for k, v in raw.items()}
        except FileNotFoundError:
            self.data = {}

    def save(self) -> None:
        Path(self.file_path).parent.mkdir(parents=True, exist_ok=True)
        with open(self.file_path, 'w') as f:
            raw = {k: vars(v) for k, v in self.data.items()}
            json.dump(raw, f, indent=2)

    def has(self, agent_id: str) -> bool:
        return agent_id in self.data

    def pin(self, agent_id: str, public_key: bytes, origin: str, verified_by: list[str] | None = None) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self.data[agent_id] = TrustRecord(
            public_key=encode_base64_url(public_key),
            first_seen=now,
            last_verified=now,
            origin=origin,
            verified_by=verified_by or ['tofu_single'],
            superseded_by=None,
        )

    def get_public_key(self, agent_id: str) -> bytes | None:
        if agent_id not in self.data:
            return None

        record = self.data[agent_id]
        if record.superseded_by:
            return self.get_public_key(record.superseded_by)

        return decode_base64_url(record.public_key)

    def update_last_verified(self, agent_id: str) -> None:
        if agent_id in self.data:
            self.data[agent_id].last_verified = datetime.now(timezone.utc).isoformat()

    def add_rotation(self, old_agent_id: str, new_agent_id: str, public_key: bytes) -> None:
        if old_agent_id in self.data:
            self.data[old_agent_id].superseded_by = new_agent_id

        now = datetime.now(timezone.utc).isoformat()
        self.data[new_agent_id] = TrustRecord(
            public_key=encode_base64_url(public_key),
            first_seen=now,
            last_verified=now,
            origin='rotation',
            verified_by=['rotation'],
            superseded_by=None,
        )

    def has_conflict(self, agent_id: str, public_key: bytes) -> bool:
        existing = self.get_public_key(agent_id)
        if existing is None:
            return False
        return existing == public_key
```

---

## 7. WebSocket Gateway

### TypeScript

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import { MessageVerifier } from './verifier';
import { signEnvelope } from './crypto';

interface GatewayOptions {
  port: number;
  secretKey: Uint8Array;
  agentId: string;
  verifier: MessageVerifier;
}

export class Gateway {
  private wss: WebSocketServer;
  private secretKey: Uint8Array;
  private agentId: string;
  private verifier: MessageVerifier;

  constructor(options: GatewayOptions) {
    this.secretKey = options.secretKey;
    this.agentId = options.agentId;
    this.verifier = options.verifier;

    this.wss = new WebSocketServer({ port: options.port, path: '/adp' });
    this.wss.on('connection', this.handleConnection.bind(this));
  }

  private async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const url = new URL(req.url, `http://localhost`);
    const remoteAgentId = url.searchParams.get('agent_id');

    console.log(`Connection from: ${remoteAgentId}`);

    ws.on('message', async (data) => {
      try {
        const envelope = JSON.parse(data.toString());
        const result = await this.verifier.verify(envelope);

        if (!result.valid) {
          await this.sendError(ws, envelope, result.error!, result.message);
          return;
        }

        await this.dispatch(ws, envelope);
      } catch (err) {
        console.error('Message handling error:', err);
      }
    });

    ws.on('close', () => {
      console.log(`Connection closed: ${remoteAgentId}`);
    });
  }

  private async dispatch(ws: WebSocket, envelope: Envelope): Promise<void> {
    switch (envelope.action) {
      case 'adp:ping':
        await this.handlePing(ws, envelope);
        break;
      case 'adp:capability.query':
        await this.handleCapabilityQuery(ws, envelope);
        break;
      case 'adp:info':
        console.log(`Info from ${envelope.from}:`, envelope.params);
        break;
      default:
        await this.sendError(ws, envelope, 'UNKNOWN_ACTION');
    }
  }

  private async handlePing(ws: WebSocket, original: Envelope): Promise<void> {
    const reply = await signEnvelope({
      protocol: 'adp/0.2',
      id: generateMessageId(),
      from: this.agentId,
      to: original.from,
      reply_to: original.id,
      action: 'adp:ping',
      params: { uptime: process.uptime() },
      timestamp: new Date().toISOString(),
    }, this.secretKey);

    ws.send(JSON.stringify(reply));
  }

  private async handleCapabilityQuery(ws: WebSocket, original: Envelope): Promise<void> {
    const reply = await signEnvelope({
      protocol: 'adp/0.2',
      id: generateMessageId(),
      from: this.agentId,
      to: original.from,
      reply_to: original.id,
      action: 'adp:capability.query',
      params: { manifest: this.manifest },
      timestamp: new Date().toISOString(),
    }, this.secretKey);

    ws.send(JSON.stringify(reply));
  }

  private async sendError(ws: WebSocket, original: Envelope, code: string, message?: string): Promise<void> {
    const error = await signEnvelope({
      protocol: 'adp/0.2',
      id: generateMessageId(),
      from: this.agentId,
      to: original.from,
      reply_to: original.id,
      action: original.action,
      params: {},
      timestamp: new Date().toISOString(),
      error: { code, message: message || code },
    }, this.secretKey);

    ws.send(JSON.stringify(error));
  }

  close(): void {
    this.wss.close();
  }
}

function generateMessageId(): string {
  return 'msg_' + Math.random().toString(36).slice(2, 10);
}
```

---

## 8. Registry API 签名

### TypeScript (请求签名)

```typescript
import { sign as naclSign } from 'tweetnacl';
import { encodeBase64URL, decodeBase64URL } from './base64';
import { canonicalize } from './canonical';

interface RegistryRequest {
  method: 'POST' | 'PUT' | 'DELETE' | 'GET';
  path: string;
  body?: object;
}

export function signRegistryRequest(
  request: RegistryRequest,
  secretKey: Uint8Array
): { signature: string; timestamp: string } {
  const timestamp = new Date().toISOString();
  const toSign = {
    method: request.method,
    path: request.path,
    timestamp,
    ...(request.body && { body: request.body }),
  };

  const canonical = canonicalize(toSign);
  const signatureBytes = naclSign(new TextEncoder().encode(canonical), secretKey);

  return {
    signature: encodeBase64URL(signatureBytes.slice(0, 64)),
    timestamp,
  };
}

export function buildRegistryHeaders(
  request: RegistryRequest,
  secretKey: Uint8Array
): Record<string, string> {
  const { signature, timestamp } = signRegistryRequest(request, secretKey);

  return {
    'Content-Type': 'application/json',
    'X-ADP-Signature': signature,
    'X-ADP-Timestamp': timestamp,
  };
}
```

### Python (请求签名)

```python
from nacl.signing import SigningKey
from nacl.encoding import RawEncoder
from datetime import datetime, timezone
from .canonical import canonicalize
from .base64 import encode_base64_url

def sign_registry_request(method: str, path: str, body: dict | None, secret_key: bytes) -> tuple[str, str]:
    timestamp = datetime.now(timezone.utc).isoformat()
    to_sign = {
        'method': method,
        'path': path,
        'timestamp': timestamp,
    }
    if body:
        to_sign['body'] = body

    canonical = canonicalize(to_sign)
    signing_key = SigningKey(secret_key, encoder=RawEncoder)
    signature_bytes = signing_key.sign(canonical.encode('utf-8'), encoder=RawEncoder)

    return encode_base64_url(signature_bytes[:64]), timestamp

def build_registry_headers(method: str, path: str, body: dict | None, secret_key: bytes) -> dict:
    signature, timestamp = sign_registry_request(method, path, body, secret_key)
    return {
        'Content-Type': 'application/json',
        'X-ADP-Signature': signature,
        'X-ADP-Timestamp': timestamp,
    }
```

---

## 9. 任务状态机

### TypeScript

```typescript
enum TaskStatus {
  PENDING = 'PENDING',
  WORKING = 'WORKING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELED = 'CANCELED',
}

interface Task {
  taskId: string;
  status: TaskStatus;
  capability: string;
  input: unknown;
  result?: unknown;
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
}

class TaskManager {
  private tasks: Map<string, Task> = new Map();

  create(capability: string, input: unknown): Task {
    const taskId = 'task_' + Math.random().toString(36).slice(2, 10);
    const now = new Date().toISOString();

    const task: Task = {
      taskId,
      status: TaskStatus.PENDING,
      capability,
      input,
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(taskId, task);
    return task;
  }

  start(taskId: string): Task {
    const task = this.get(taskId);
    if (!task) throw new Error('Task not found');
    if (task.status !== TaskStatus.PENDING) {
      throw new Error(`Cannot start task in ${task.status} status`);
    }

    task.status = TaskStatus.WORKING;
    task.updatedAt = new Date().toISOString();
    return task;
  }

  complete(taskId: string, result: unknown): Task {
    const task = this.get(taskId);
    if (!task) throw new Error('Task not found');
    if (task.status !== TaskStatus.WORKING) {
      throw new Error(`Cannot complete task in ${task.status} status`);
    }

    task.status = TaskStatus.COMPLETED;
    task.result = result;
    task.updatedAt = new Date().toISOString();
    return task;
  }

  fail(taskId: string, error: { code: string; message: string }): Task {
    const task = this.get(taskId);
    if (!task) throw new Error('Task not found');
    if (task.status !== TaskStatus.WORKING) {
      throw new Error(`Cannot fail task in ${task.status} status`);
    }

    task.status = TaskStatus.FAILED;
    task.error = error;
    task.updatedAt = new Date().toISOString();
    return task;
  }

  cancel(taskId: string): Task {
    const task = this.get(taskId);
    if (!task) throw new Error('Task not found');
    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.FAILED || task.status === TaskStatus.CANCELED) {
      throw new Error(`Cannot cancel task in ${task.status} status`);
    }

    task.status = TaskStatus.CANCELED;
    task.updatedAt = new Date().toISOString();
    return task;
  }

  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  list(filter?: { status?: TaskStatus; cursor?: string; limit?: number }): { tasks: Task[]; nextCursor: string | null } {
    let tasks = Array.from(this.tasks.values());

    if (filter?.status) {
      tasks = tasks.filter(t => t.status === filter.status);
    }

    tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const limit = filter?.limit ?? 20;
    const start = filter?.cursor ? parseInt(filter.cursor, 10) : 0;

    const page = tasks.slice(start, start + limit);
    const nextCursor = start + limit < tasks.length ? String(start + limit) : null;

    return { tasks: page, nextCursor };
  }
}
```
