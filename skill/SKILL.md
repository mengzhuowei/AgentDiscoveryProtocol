---
name: "adp-agent-integration"
description: "Integrates ADP Agent for cross-agent discovery, messaging, and MCP connectivity. Invoke when user wants to enable agent-to-agent communication with OpenClaw, Hermes Agent, or other frameworks using the adp-agent npm package."
---

# ADP Agent Integration Skill

This skill teaches you how to integrate [Agent Discovery Protocol (ADP)](https://github.com/mengzhuowei/AgentDiscoveryProtocol) into any agent framework (OpenClaw, Hermes Agent, etc.) using only the published `adp-agent` npm package.

## Installation

```bash
npm install adp-agent
```

## Core Concepts

ADP provides three integration modes:

| Mode | Use Case | Compatible With |
|------|----------|-----------------|
| **Gateway** | Run ADP as a standalone WebSocket agent with custom capability handlers | Any agent framework that can start a Node.js process |
| **MCP Server** | Expose ADP discovery and messaging as MCP tools/resources | Any MCP-compatible host (Claude Desktop, etc.) |
| **Client-only** | Call other ADP agents without hosting your own Gateway | Hermes Agent, script-based agents |

## Key APIs (imported from `adp-agent`)

```typescript
import {
  Gateway,                    // Run an ADP agent server
  loadOrCreateIdentity,       // Create/load a persistent agent identity
  Discovery,                  // mDNS-based peer discovery
  connectToAgent,             // WebSocket connection to another agent
  signEnvelope,               // Sign & build a secure message envelope
  generateMessageId,          // Generate unique message IDs
  canonicalize,               // Canonical JSON serialization
  MessageVerifier,            // Verify incoming message signatures
  TaskManager,                // Manage async tasks
  RegistryClient,             // Registry-based agent lookup
  RelayClient,                // Relay-based communication
  ContactStore,               // Persistent contact management
  createEchoHandler,          // Built-in echo capability handler
  createChatHandler,          // Built-in chat capability handler
  AdpMcpServer,               // Run as MCP server
  setLogger,                  // Configure logging
  findAvailablePort,          // Utility to find free ports
  // Types
  type Envelope,              // Message envelope structure
  type Capability,            // Capability descriptor
  type Route,                 // Communication routes
  type Manifest,              // Agent manifest
  type Identity,              // Agent identity (agentId + keys)
  type ActionHandler,         // Custom action handler type
  type GatewayOptions,        // Gateway configuration
  type CommunicationConfig,   // WebSocket/webhook/hybrid config
} from 'adp-agent';
```

## Integration Patterns

### Pattern 1: Gateway Mode (Standalone ADP Agent)

Run ADP as an independent WebSocket server. Best for agents that need to be discovered and called by other ADP agents.

```typescript
import { Gateway, loadOrCreateIdentity, signEnvelope, generateMessageId, canonicalize } from 'adp-agent';

// 1. Load or create a persistent identity (keys saved to .adp/keys/)
const { identity } = loadOrCreateIdentity('myapp', 'my-agent', 'MyAgent');

// 2. Define capabilities
const myCapabilities = [
  'adp:ping',
  'adp:capability.query',
  'adp:info',
  {
    capability: 'custom:my-action',
    description: 'Description of what this action does',
    input_schema: {
      type: 'object',
      properties: {
        inputParam: { type: 'string', description: 'Some input' },
      },
      required: ['inputParam'],
    },
    output_schema: {
      type: 'object',
      properties: {
        result: { type: 'string' },
      },
    },
  },
];

// 3. Define action handlers
const handlers = {
  'custom:my-action': async (ws, envelope) => {
    const params = envelope.params as { inputParam?: string };
    console.log('Received request:', params);

    const reply = signEnvelope({
      protocol: 'adp/0.2',
      id: generateMessageId(),
      from: identity.agentId,
      to: envelope.from,
      action: 'custom:my-action',
      params: { result: `Hello, ${params.inputParam}!` },
      reply_to: envelope.id,
      timestamp: new Date().toISOString(),
    }, identity.secretKey, canonicalize);

    ws.send(JSON.stringify(reply));
  },
};

// 4. Create the Gateway
const gateway = new Gateway({
  port: 9900,
  host: '0.0.0.0',
  secretKey: identity.secretKey,
  agentId: identity.agentId,
  displayName: 'My ADP Agent',
  capabilities: myCapabilities,
  customHandlers: handlers,
});

console.log(`ADP Agent running at ws://localhost:9900/adp`);
console.log(`Agent ID: ${identity.agentId}`);
```

### Pattern 2: OpenClaw Integration

OpenClaw agents use function/tool calling. ADP provides the networking layer — connect OpenClaw to other ADP agents for tool execution.

```typescript
import { Gateway, loadOrCreateIdentity, connectToAgent, signEnvelope, generateMessageId, canonicalize } from 'adp-agent';

async function setupOpenClawAgent() {
  const { identity } = loadOrCreateIdentity('openclaw', 'adp-bridge', 'ADPBridge');

  const gateway = new Gateway({
    port: 9900,
    secretKey: identity.secretKey,
    agentId: identity.agentId,
    displayName: 'OpenClaw ADP Bridge',
    capabilities: [
      'adp:ping',
      'adp:capability.query',
    ],
  });

  // Call another ADP agent's capability from your OpenClaw logic
  async function callRemoteAgent(targetAgentId: string, targetAddress: string, action: string, params: object) {
    const ws = await connectToAgent(targetAgentId, targetAddress, identity.agentId);

    try {
      const envelope = signEnvelope({
        protocol: 'adp/0.2',
        id: generateMessageId(),
        from: identity.agentId,
        to: targetAgentId,
        action,
        params,
        timestamp: new Date().toISOString(),
      }, identity.secretKey, canonicalize);

      ws.send(JSON.stringify(envelope));

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Response timeout'));
        }, 30000);

        ws.on('message', (data) => {
          clearTimeout(timeout);
          const response = JSON.parse(data.toString());
          ws.close();
          resolve(response.params);
        });

        ws.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    } finally {
      ws.close();
    }
  }

  // Example: Use as an OpenClaw tool
  const openclawTool = {
    name: 'call_adp_agent',
    description: 'Call a capability on a remote ADP agent',
    parameters: {
      type: 'object',
      properties: {
        targetAddress: { type: 'string', description: 'host:port of the target agent' },
        action: { type: 'string', description: 'Capability to invoke (e.g. custom:my-action)' },
        params: { type: 'object', description: 'Parameters to pass' },
      },
      required: ['targetAddress', 'action'],
    },
    execute: async (args: { targetAddress: string; action: string; params: object }) => {
      return callRemoteAgent(identity.agentId, args.targetAddress, args.action, args.params || {});
    },
  };

  return { gateway, openclawTool };
}
```

### Pattern 3: Hermes Agent Integration

Hermes Agent uses a plugin/tool architecture. ADP becomes a tool that discovers and communicates with other agents.

```typescript
import { Discovery, connectToAgent, loadOrCreateIdentity, signEnvelope, generateMessageId, canonicalize } from 'adp-agent';

async function createHermesTool() {
  const { identity } = loadOrCreateIdentity('hermes', 'adp-tool', 'ADPTool');

  return {
    // Tool 1: Discover nearby ADP agents
    discoverAgents: {
      name: 'adp_discover',
      description: 'Discover nearby ADP agents via mDNS',
      execute: async () => {
        return new Promise((resolve, reject) => {
          const peers: Array<{ agentId: string; host: string; port: number }> = [];
          const discovery = new Discovery(identity.agentId, 0, {
            onPeerDiscovered: (peer) => {
              peers.push({
                agentId: peer.agentId,
                host: peer.host,
                port: peer.port,
              });
            },
            onPeerLost: () => {},
          });

          discovery.start();

          setTimeout(() => {
            discovery.shutdown();
            resolve(peers);
          }, 3000);

          setTimeout(() => reject(new Error('Discovery timeout')), 5000);
        });
      },
    },

    // Tool 2: Query a remote agent's capabilities
    queryCapabilities: {
      name: 'adp_query',
      description: 'Query capabilities of a remote ADP agent',
      execute: async (args: { address: string }) => {
        const ws = await connectToAgent(identity.agentId, args.address, identity.agentId);
        try {
          const queryMsg = signEnvelope({
            protocol: 'adp/0.2',
            id: generateMessageId(),
            from: identity.agentId,
            to: identity.agentId,
            action: 'adp:capability.query',
            params: {},
            timestamp: new Date().toISOString(),
          }, identity.secretKey, canonicalize);

          ws.send(JSON.stringify(queryMsg));

          return new Promise((resolve, reject) => {
            ws.on('message', (data) => {
              const env = JSON.parse(data.toString());
              ws.close();
              resolve(env.params);
            });
            ws.on('error', reject);
            setTimeout(() => { ws.close(); reject(new Error('Timeout')); }, 10000);
          });
        } finally {
          ws.close();
        }
      },
    },

    // Tool 3: Call any capability on a remote agent
    callCapability: {
      name: 'adp_call',
      description: 'Call a specific capability on a remote ADP agent',
      execute: async (args: { address: string; action: string; params: object }) => {
        const ws = await connectToAgent(identity.agentId, args.address, identity.agentId);
        try {
          const msg = signEnvelope({
            protocol: 'adp/0.2',
            id: generateMessageId(),
            from: identity.agentId,
            to: identity.agentId,
            action: args.action,
            params: args.params || {},
            timestamp: new Date().toISOString(),
          }, identity.secretKey, canonicalize);

          ws.send(JSON.stringify(msg));

          return new Promise((resolve, reject) => {
            ws.on('message', (data) => {
              const env = JSON.parse(data.toString());
              ws.close();
              resolve(env.params);
            });
            ws.on('error', reject);
            setTimeout(() => { ws.close(); reject(new Error('Timeout')); }, 30000);
          });
        } finally {
          ws.close();
        }
      },
    },
  };
}
```

### Pattern 4: MCP Server Mode

Run ADP as an MCP server that exposes agent discovery and communication as MCP tools. Compatible with any MCP host (Claude Desktop, VS Code extensions, etc.).

```typescript
import { AdpMcpServer } from 'adp-agent';

const server = new AdpMcpServer({
  tag: 'my-agent',
  namespace: 'myapp',
  agentName: 'adp-mcp',
  displayName: 'ADP MCP Agent',
  portBase: 9900,
  capabilities: [
    'adp:ping',
    'adp:capability.query',
    {
      capability: 'custom:my-action',
      description: 'My custom action',
      input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  ],
  description: 'An ADP-powered MCP agent',
});

await server.start();
```

### Pattern 5: Webhook Mode (for non-WebSocket frameworks)

For agent frameworks that don't support WebSocket, use ADP's webhook communication mode. Webhooks are ideal for long-running async tasks where the result is delivered later.

#### 5.1 Configure Gateway with Webhook

```typescript
import { Gateway, loadOrCreateIdentity, signEnvelope, canonicalize, generateMessageId } from 'adp-agent';

const { identity } = loadOrCreateIdentity('myapp', 'webhook-agent', 'WebhookAgent');

const gateway = new Gateway({
  port: 9900,
  secretKey: identity.secretKey,
  agentId: identity.agentId,
  displayName: 'Webhook Agent',
  capabilities: [
    'adp:ping',
    'adp:capability.query',
    {
      capability: 'custom:video.generate',
      description: 'Generate video (async task)',
      async: true,
      preferredMode: 'webhook',
    },
  ],
  communication: {
    mode: 'webhook',
    webhook: {
      enabled: true,
      url: 'https://my-agent.example.com/webhook/adp',
      secret: 'your-webhook-secret',
      timeout: 30000,
      retry: {
        maxAttempts: 3,
        backoffMs: 1000,
      },
    },
  },
  customHandlers: {
    'custom:video.generate': async (ws, envelope) => {
      const params = envelope.params as { prompt?: string; duration?: number };
      
      console.log('Starting video generation...');
      
      // Simulate async work
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const reply = signEnvelope({
        protocol: 'adp/0.2',
        id: generateMessageId(),
        from: identity.agentId,
        to: envelope.from,
        action: 'custom:video.generate',
        params: {
          task_id: envelope.params?.task_id,
          status: 'COMPLETED',
          result: {
            video_url: 'https://cdn.example.com/video.mp4',
            thumbnail_url: 'https://cdn.example.com/thumb.jpg',
          },
        },
        reply_to: envelope.id,
        timestamp: new Date().toISOString(),
      }, identity.secretKey, canonicalize);
      
      ws.send(JSON.stringify(reply));
    },
  },
});
```

#### 5.2 Receive Webhook Callbacks

Your agent framework needs an HTTP endpoint to receive webhook callbacks:

```typescript
import * as http from 'http';
import { WebhookClient, WebhookPayload, WebhookEvent } from 'adp-agent';

interface WebhookPayload {
  event: WebhookEvent;
  task_id: string;
  agent_id: string;
  timestamp: string;
  signature: string;
  data: {
    result?: unknown;
    error?: { code: string; message: string };
    progress?: { current: number; total: number; message: string };
  };
}

function startWebhookServer(port: number) {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/webhook/adp') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body) as WebhookPayload;
          
          console.log(`Received webhook: ${payload.event}`);
          console.log(`Task ID: ${payload.task_id}`);
          console.log(`Data:`, payload.data);
          
          // Handle different event types
          switch (payload.event) {
            case 'task.completed':
              console.log('Task completed successfully!');
              break;
            case 'task.failed':
              console.error('Task failed:', payload.data.error);
              break;
            case 'task.progress':
              console.log('Task progress:', payload.data.progress);
              break;
          }
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        } catch (error) {
          console.error('Failed to parse webhook:', error);
          res.writeHead(400);
          res.end('Invalid JSON');
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  
  server.listen(port, () => {
    console.log(`Webhook server listening on port ${port}`);
  });
}

startWebhookServer(8080);
```

#### 5.3 Verify Webhook Signatures

For security, always verify webhook signatures:

```typescript
import { WebhookClient, WebhookPayload } from 'adp-agent';
import { loadIdentity } from 'adp-agent';

function verifyWebhook(payload: WebhookPayload, agentId: string): boolean {
  // Load the sender's public key from their agent ID
  const identity = loadIdentity('namespace', 'agent-name', 'tag');
  if (!identity) {
    console.error('Unknown agent');
    return false;
  }
  
  const isValid = WebhookClient.verifyWebhookSignature(payload, identity.publicKey);
  
  if (!isValid) {
    console.error('Invalid webhook signature!');
    return false;
  }
  
  console.log('Webhook signature verified');
  return true;
}

// Usage in webhook handler:
const payload = JSON.parse(body) as WebhookPayload;
if (verifyWebhook(payload, payload.agent_id)) {
  // Process the webhook
}
```

#### 5.4 Webhook Events

| Event | Description | Data Structure |
|-------|-------------|----------------|
| `task.completed` | Task finished successfully | `{ result: T }` |
| `task.failed` | Task failed with error | `{ error: { code, message } }` |
| `task.progress` | Task progress update | `{ progress: { current, total, message } }` |

#### 5.5 Hybrid Mode (WebSocket + Webhook)

Use hybrid mode for best of both worlds — sync responses via WebSocket, async callbacks via webhook:

```typescript
const gateway = new Gateway({
  port: 9900,
  secretKey: identity.secretKey,
  agentId: identity.agentId,
  displayName: 'Hybrid Agent',
  capabilities: [
    {
      capability: 'custom:quick.action',
      description: 'Fast sync action',
      async: false,
      preferredMode: 'websocket',
    },
    {
      capability: 'custom:long.task',
      description: 'Long async task',
      async: true,
      preferredMode: 'webhook',
    },
  ],
  communication: {
    mode: 'hybrid',
    webhook: {
      enabled: true,
      url: 'https://my-agent.example.com/webhook/adp',
      secret: 'your-webhook-secret',
    },
  },
});
```

## Agent Discovery

```typescript
import { Discovery, loadOrCreateIdentity } from 'adp-agent';

const { identity } = loadOrCreateIdentity('myapp', 'discovery-demo', 'DiscoveryDemo');

const discovery = new Discovery(identity.agentId, 9900, {
  onPeerDiscovered: (peer) => {
    console.log(`Found agent: ${peer.agentId} at ${peer.host}:${peer.port}`);
    // peer.manifest contains the agent's full capability list
    console.log('Capabilities:', peer.manifest?.capabilities);
  },
  onPeerLost: (agentId) => {
    console.log(`Agent lost: ${agentId}`);
  },
});

discovery.start();

// Later:
discovery.shutdown();
```

## Registry-based Discovery

```typescript
import { RegistryClient, loadOrCreateIdentity, connectToAgent, signEnvelope, generateMessageId, canonicalize } from 'adp-agent';

const { identity } = loadOrCreateIdentity('myapp', 'registry-demo', 'RegistryDemo');

const registry = new RegistryClient({
  registryUrl: 'https://your-registry.example.com',
  agentId: identity.agentId,
  secretKey: identity.secretKey,
});

// Register yourself
await registry.register({
  displayName: 'My Agent',
  capabilities: ['adp:ping'],
  routes: [{ type: 'direct', address: 'localhost:9900' }],
});

// Find agents by capability
const agents = await registry.query({ capability: 'custom:video.generate' });
console.log('Found agents:', agents);

// Get agent manifest
const manifest = await registry.resolve(agents[0].agentId);
console.log('Manifest:', manifest);
```

## Envelope & Message Signing (Low-level API)

Use this when you need direct control over message construction.

```typescript
import { signEnvelope, generateMessageId, canonicalize, buildEnvelope } from 'adp-agent';

const signed = signEnvelope({
  protocol: 'adp/0.2',
  id: generateMessageId(),
  from: identity.agentId,
  to: targetAgentId,
  action: 'custom:my-action',
  params: { key: 'value' },
  timestamp: new Date().toISOString(),
}, identity.secretKey, canonicalize);

// signed.sig is automatically computed and attached
console.log(signed);
```

## Task Management

For long-running operations, use the built-in TaskManager.

```typescript
import { Gateway, TaskManager, loadOrCreateIdentity } from 'adp-agent';

const { identity } = loadOrCreateIdentity('myapp', 'task-agent', 'TaskAgent');
const taskManager = new TaskManager();

const gateway = new Gateway({
  port: 9900,
  secretKey: identity.secretKey,
  agentId: identity.agentId,
  displayName: 'Task Agent',
  capabilities: ['adp:task.create', 'adp:task.get', 'adp:task.list', 'adp:task.cancel'],
  taskManager,
  customHandlers: {
    'custom:long-task': async (ws, envelope) => {
      const task = await taskManager.createTask({
        requester: envelope.from,
        action: 'custom:long-task',
        params: envelope.params,
        secretKey: identity.secretKey,
        envelopeId: envelope.id,
      });

      // Work on the task asynchronously...
      setTimeout(async () => {
        await taskManager.completeTask(task.id, { result: 'done' }, identity.secretKey);
      }, 5000);

      // Send back the task ID
      const reply = signEnvelope({
        protocol: 'adp/0.2',
        id: generateMessageId(),
        from: identity.agentId,
        to: envelope.from,
        action: 'adp:task.create',
        params: { task_id: task.id, status: 'PENDING' },
        reply_to: envelope.id,
        timestamp: new Date().toISOString(),
      }, identity.secretKey, canonicalize);

      ws.send(JSON.stringify(reply));
    },
  },
});
```

## Configuration Reference

### GatewayOptions

```typescript
interface GatewayOptions {
  port: number;                    // WebSocket server port
  host?: string;                   // Bind address (default: 'localhost')
  secretKey: Uint8Array;          // Ed25519 secret key from identity
  agentId: string;                // ADP agent ID from identity
  displayName: string;            // Human-readable agent name
  capabilities: (string | Capability)[];  // Declared capabilities
  routes?: Route[];               // Connection routes
  customHandlers?: Record<string, ActionHandler>;  // Action handlers
  taskManager?: TaskManager;      // Task management
  contacts?: ContactStore;        // Contact book
  skipVerification?: boolean;     // Skip signature verification (dev only)
  tofuEnabled?: boolean;          // Trust On First Use
  communication?: CommunicationConfig;  // Webhook/hybrid config
  tls?: { cert: string; key: string };  // TLS options
}
```

## Key Constraints

- **Ed25519 keys only**: ADP uses `tweetnacl`'s Ed25519 implementation. Key pairs can be generated with `generateKeyPair()` or loaded via `loadOrCreateIdentity()`.
- **WebSocket required for Gateway**: The Gateway mode requires WebSocket. For non-WS frameworks, use webhook mode or client-only mode.
- **mDNS for LAN discovery**: mDNS works only within the same local network. For WAN discovery, use the Registry.
- **Message size limit**: Messages are limited to 1MB (`MESSAGE_SIZE_LIMIT`).

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `connectToAgent` fails | Ensure target agent's Gateway is running and reachable. Check firewall rules. |
| mDNS discovery finds nothing | Verify agents are on the same LAN. Check `ADP_DISABLE_MDNS` env var. |
| Signature verification fails | Ensure both sides use the same `canonicalize` function. |
| Port already in use | Use `findAvailablePort()` utility to pick a free port. |
