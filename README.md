<div align="center">

[中文](README.zh.md) | **English**

</div>

<div align="center">
  <h1>
    <br>
    <br>
    🤖 Agent Discovery Protocol (ADP)
    <br>
    <br>
  </h1>
</div>

<div align="center">

[![npm version](https://img.shields.io/npm/v/adp-agent.svg?style=flat-square)](https://www.npmjs.com/package/adp-agent)
[![GitHub license](https://img.shields.io/github/license/mengzhuowei/AgentDiscoveryProtocol.svg?style=flat-square)](https://github.com/mengzhuowei/AgentDiscoveryProtocol/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4%2B-blue.svg?style=flat-square)](https://www.typescriptlang.org/)
[![protocol version](https://img.shields.io/badge/protocol-adp%2F0.2-orange.svg?style=flat-square)](docs/README.md)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-green.svg?style=flat-square)](https://modelcontextprotocol.io/)

</div>

<div align="center">
  <strong>Enable AI agents to discover and communicate with each other, without a centralized platform</strong>
</div>

<br>

<div align="center">
  <a href="#-platform-definition">Definition</a> •
  <a href="#-core-components">Components</a> •
  <a href="#-technical-goals">Goals</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-installation">Installation</a> •
  <a href="#-usage-examples">Examples</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-documentation">Docs</a>
</div>

<br>

---

## Platform Definition

ADP (Agent Discovery Protocol) is a decentralized agent discovery and communication protocol that enables AI agents to discover each other, establish connections, and communicate securely without any centralized platform. Through self-authenticating cryptographic identities, mDNS zero-config discovery, and mandatory Ed25519 signature verification, ADP provides a secure and reliable infrastructure for inter-agent collaboration.

## Core Components

### 1. Self-Authenticating Identity System

A self-authenticating identity system based on Ed25519 public-key cryptography. The Agent ID directly embeds the public key, and whoever holds the private key owns that identity.

- **Zero-trust architecture** — No centralized authentication service required
- **Key rotation** — Supports secure key update mechanisms
- **Persistent storage** — Keys are securely stored in the local filesystem

### 2. Discovery Mechanisms

Multiple discovery methods to suit different network environments.

- **mDNS zero-config discovery** — Automatic discovery on LAN, no manual configuration needed
- **Registry directory service** — Optional centralized directory for WAN discovery
- **Relay service** — Communication relay that traverses NAT and firewalls

### 3. Message Transport Layer

Real-time message transmission based on WebSocket, supporting multiple communication modes.

- **WebSocket direct connection** — Point-to-point direct communication
- **Webhook callbacks** — Ideal for delivering results of long-running async tasks
- **Hybrid mode** — WebSocket for sync responses, Webhook for async callbacks

### 4. Security & Trust

Mandatory signature verification with flexible trust management mechanisms.

- **Ed25519 signatures** — All messages are mandatorily signature-verified
- **TOFU (Trust On First Use)** — Automatic trust on first verified connection
- **Trust store** — Configurable trust policies and blacklists

### 5. MCP Integration

Native support for Model Context Protocol, can run directly as an MCP server.

- **MCP Server** — Expose ADP capabilities as MCP tools
- **Claude Desktop compatible** — Seamless integration with Claude Desktop
- **Tool discovery** — Automatically discover and invoke other ADP agents

## Technical Goals

- **Decentralization first** — Works within a LAN without any centralized services
- **Security first** — All messages mandatorily signature-verified to prevent MITM attacks
- **Interoperability** — Compatible with OpenClaw, Hermes Agent, and other major agent frameworks
- **Observability** — Complete logging and tracing mechanisms
- **Extensibility** — Modular design supporting custom capability handlers

## Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                    Application Layer (Agent Frameworks)      │
│  OpenClaw • Hermes Agent • MCP Host • Custom Applications        │
└────────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────────▼────────────────────────────────────┐
│                    ADP Gateway                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Capability    │  │   Task       │  │   Contact    │   │
│  │   Handlers    │  │   Manager    │  │   Manager    │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────────▼────────────────────────────────────┐
│                    Message Layer (Envelope)                    │
│  Protocol • ID • From • To • Action • Params • Signature       │
└────────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────────▼────────────────────────────────────┐
│                    Transport Layer                             │
│  ┌──────────────┐              ┌──────────────┐            │
│  │ WebSocket    │              │ Webhook      │            │
│  │ Direct/Relay │              │ Callbacks    │            │
│  └──────────────┘              └──────────────┘            │
└────────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────────▼────────────────────────────────────┐
│                    Discovery Layer                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ mDNS        │  │ Registry     │  │ Relay        │   │
│  │ LAN Discovery│  │ Directory    │  │ NAT Relay    │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
└───────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- **Node.js** : 18+
- **npm** : 9+
- **TypeScript** : 5.4+ (for development)

### Local Development

1. **Clone the repository**

```bash
git clone https://github.com/mengzhuowei/AgentDiscoveryProtocol.git
cd AgentDiscoveryProtocol
```

2. **Install dependencies**

```bash
npm install
```

3. **Start Agent**

```bash
# Terminal 1: Start first agent
npm start

# Terminal 2: Start second agent (automatically discovers the first)
npm start
```

4. **Start Registry and Relay (optional)**

```bash
# Terminal 3: Start Registry service
npm run registry

# Terminal 4: Start Relay service
npm run relay
```

### Docker Deployment

```bash
# Start the complete ADP ecosystem (Gateway + Registry + Relay)
docker-compose up -d
```

See [Docker Deployment Guide](docs/docker.md) for details.

## Installation

### Use as a Library

```bash
npm install adp-agent
```

### Global Installation

```bash
npm install -g adp-agent
```

After installation, the `skill/` directory is automatically copied to your project root, containing complete integration documentation.

### Available Commands

After global installation, you can use the following commands:

| Command | Description |
|---------|-------------|
| `adp-agent` | Start MCP Server |
| `adp-registry` | Start Registry service |
| `adp-relay` | Start Relay service |

#### adp-agent Command Options

```bash
adp-agent [tag] [options]
```

| Argument | Description | Default |
|----------|-------------|---------|
| `[tag]` | Agent identifier name | `agent1` |
| `--relay=<url>` | Set Relay server address | - |
| `--registry=<url>` | Set Registry server address | - |
| `--name=<name>` | Set Agent name | - |
| `--direct` | Disable mDNS discovery, force direct connection mode | - |

| Environment Variable | Description | Default |
|-----------------------|-------------|---------|
| `ADP_RELAY` | Relay server address | - |
| `ADP_REGISTRY` | Registry server address | - |
| `ADP_REGISTRY_TOKEN` | Registry access token | - |
| `ADP_NAMESPACE` | Agent namespace | `local` |
| `ADP_NAME` | Agent name | - |

Config file: `.adp/config.json` (project directory or user home directory)

#### adp-registry Command Options

```bash
adp-registry
```

No command-line arguments required. All configuration is through environment variables or config file.

| Environment Variable | Description | Default |
|-----------------------|-------------|---------|
| `ADP_CONFIG` | Config file path | `config.json` |
| `REGISTRY_PORT` | Service port | `3000` |
| `REGISTRY_HOST` | Service address | `0.0.0.0` |
| `MYSQL_HOST` | MySQL database address | `127.0.0.1` |
| `MYSQL_PORT` | MySQL database port | `3306` |
| `MYSQL_USER` | MySQL username | `root` |
| `MYSQL_PASSWORD` | MySQL password | - |
| `MYSQL_DATABASE` | MySQL database name | `adp_registry` |
| `REDIS_HOST` | Redis address | `127.0.0.1` |
| `REDIS_PORT` | Redis port | `6379` |
| `REDIS_PASSWORD` | Redis password | - |
| `TOKEN_ENABLED` | Enable token authentication | `false` |
| `CORS_ENABLED` | Enable CORS | `false` |
| `CORS_ORIGINS` | CORS allowed origins (comma-separated) | `*` |

#### adp-relay Command Options

```bash
adp-relay
```

No command-line arguments required. All configuration is through environment variables.

| Environment Variable | Description | Default |
|-----------------------|-------------|---------|
| `ADP_RELAY_PORT` | Service port | `9700` |
| `ADP_RELAY_HOST` | Service address | `0.0.0.0` |
| `ADP_RELAY_MAX_CONNECTIONS` | Max connections | `10000` |
| `ADP_RELAY_HEARTBEAT_INTERVAL_MS` | Heartbeat interval (ms) | `15000` |
| `ADP_RELAY_HEARTBEAT_TIMEOUT_MS` | Heartbeat timeout (ms) | `45000` |
| `ADP_RELAY_OFFLINE_MAX_AGE_MS` | Max offline message retention (ms) | `86400000` |
| `ADP_RELAY_OFFLINE_MAX_PER_AGENT` | Max offline messages per agent | `500` |

```bash
# Start MCP Server
adp-agent

# Start Registry service
adp-registry

# Start Relay service
adp-relay
```

## Usage Examples

### Basic Gateway

```typescript
import { Gateway, loadOrCreateIdentity } from 'adp-agent';

const { identity } = loadOrCreateIdentity('myapp', 'my-agent', 'My Agent');

const gateway = new Gateway({
  port: 9900,
  host: '0.0.0.0',
  secretKey: identity.secretKey,
  agentId: identity.agentId,
  displayName: 'My Agent',
  capabilities: ['adp:ping', 'adp:capability.query'],
});

console.log(`Agent running at ws://localhost:9900/adp`);
console.log(`Agent ID: ${identity.agentId}`);
```

### Custom Capability Handler

```typescript
import { Gateway, loadOrCreateIdentity, signEnvelope, generateMessageId, canonicalize } from 'adp-agent';

const { identity } = loadOrCreateIdentity('myapp', 'video-agent', 'VideoAgent');

const gateway = new Gateway({
  port: 9900,
  secretKey: identity.secretKey,
  agentId: identity.agentId,
  displayName: 'Video Generator',
  capabilities: [
    'adp:ping',
    'adp:capability.query',
    {
      capability: 'custom:video.generate',
      description: 'Generate video from prompt',
      input_schema: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          duration: { type: 'integer', default: 5 },
        },
        required: ['prompt'],
      },
    },
  ],
  customHandlers: {
    'custom:video.generate': async (ws, envelope) => {
      const params = envelope.params as { prompt?: string; duration?: number };

      console.log(`Generating video: ${params.prompt}`);

      const reply = signEnvelope({
        protocol: 'adp/0.2',
        id: generateMessageId(),
        from: identity.agentId,
        to: envelope.from,
        action: 'custom:video.generate',
        params: {
          video_url: 'https://cdn.example.com/video.mp4',
        },
        reply_to: envelope.id,
        timestamp: new Date().toISOString(),
      }, identity.secretKey, canonicalize);

      ws.send(JSON.stringify(reply));
    },
  },
});
```

### Agent Discovery

```typescript
import { Discovery, loadOrCreateIdentity } from 'adp-agent';

const { identity } = loadOrCreateIdentity('myapp', 'discovery-demo', 'DiscoveryDemo');

const discovery = new Discovery(identity.agentId, 9900, {
  onPeerDiscovered: (peer) => {
    console.log(`Found agent: ${peer.agentId}`);
    console.log(`Address: ${peer.host}:${peer.port}`);
    console.log(`Capabilities:`, peer.manifest?.capabilities);
  },
  onPeerLost: (agentId) => {
    console.log(`Agent lost: ${agentId}`);
  },
});

discovery.start();
```

### Registry Client

```typescript
import { RegistryClient, loadOrCreateIdentity } from 'adp-agent';

const { identity } = loadOrCreateIdentity('myapp', 'registry-client', 'RegistryClient');

const registry = new RegistryClient({
  registryUrl: 'http://localhost:9800',
  agentId: identity.agentId,
  secretKey: identity.secretKey,
});

// Register yourself
await registry.register({
  displayName: 'My Agent',
  capabilities: ['adp:ping', 'custom:my-action'],
  routes: [{ type: 'direct', address: 'localhost:9900' }],
});

// Query other agents
const agents = await registry.query({ capability: 'custom:video.generate' });
console.log('Found agents:', agents);

// Get Agent Manifest
const manifest = await registry.resolve(agents[0].agentId);
console.log('Manifest:', manifest);
```

### Relay Client

```typescript
import { RelayClient, loadOrCreateIdentity, generateMessageId } from 'adp-agent';

const { identity } = loadOrCreateIdentity('myapp', 'relay-client', 'RelayClient');

const relay = new RelayClient({
  relayUrl: 'ws://localhost:9700/adp/relay',
  agentId: identity.agentId,
  secretKey: identity.secretKey,
});

// Connect to Relay
await relay.connect();

// Send message through Relay
await relay.sendMessage(targetAgentId, {
  protocol: 'adp/0.2',
  id: generateMessageId(),
  from: identity.agentId,
  to: targetAgentId,
  action: 'adp:ping',
  params: {},
  timestamp: new Date().toISOString(),
});

// Listen for messages from Relay
relay.on('message', (envelope) => {
  console.log('Received message:', envelope);
});

relay.disconnect();
```

### MCP Server Mode

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
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  ],
});

await server.start();
```

Or use the globally installed command:

```bash
adp-agent
```

More examples are available in the [examples/](examples/) directory.

## Development

```bash
npm test                             # Run tests
npm run test:integration     # Integration tests
npm run test:coverage       # Test coverage
npm run build               # Build to dist/
npm run dev                # Watch mode build
```

### Start Services

#### Development Mode (run from source)

```bash
npm run relay               # Start Relay service
npm run registry            # Start Registry service
npm run adp                # Start MCP Server
```

#### Production Mode (run after global installation)

```bash
adp-relay                 # Start Relay service
adp-registry              # Start Registry service
adp-agent                 # Start MCP Server
```

## Documentation

| Document | Description |
|----------|-------------|
| [Usage Guide](USAGE.md) | Complete usage and configuration options |
| [Docker Deployment](docs/docker.md) | Docker deployment guide |
| [Identity & Manifest](docs/01-identity.md) | Agent ID, capability declaration, key management |
| [Message Format](docs/02-message.md) | Envelope, signatures, error codes |
| [Discovery Mechanisms](docs/03-discovery.md) | mDNS, Registry, Relay |
| [Transport Layer](docs/04-transport.md) | WebSocket, Webhook, hybrid mode |
| [Security & Trust](docs/05-security.md) | TOFU, signature verification, trust store |
| [Implementation Checklist](docs/implementation-checklist.md) | Protocol compliance checklist |
| [Integration Guide](skill/SKILL.md) | OpenClaw, Hermes Agent integration guide |

## Roadmap

- [x] **v0.2** — Self-authenticating identity, signature verification, TOFU
- [x] **Registry** — Centralized directory service
- [x] **MCP Integration** — Run as MCP service
- [x] **Webhook Communication** — Async task callback support
- [x] **Key Rotation** — Secure key update mechanism
- [ ] **Task Delegation** — Cross-agent task scheduling
- [ ] **End-to-End Encryption** — Optional E2EE
- [ ] **Multi-language implementations** — Python, Rust, Go

## Contributing

We welcome contributions! Please follow these steps:

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

See [Code Standards](docs/implementation-checklist.md) for details.

## License

MIT © [ADP Working Group](https://github.com/mengzhuowei/AgentDiscoveryProtocol)

## Support & Contact

- **Issues** : [GitHub Issues](https://github.com/mengzhuowei/AgentDiscoveryProtocol/issues)
- **Discussions** : [GitHub Discussions](https://github.com/mengzhuowei/AgentDiscoveryProtocol/discussions)
- **Email** : mengzhuowei@qq.com