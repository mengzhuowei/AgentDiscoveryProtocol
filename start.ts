import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  Gateway, connectToAgent,
  loadOrCreateIdentity, STANDARD_CAPABILITIES,
  RelayClient, Discovery, DiscoveredPeer,
  ContactStore, Route
} from './src';
import { RegistryClient } from './src/registry/client';
import { signEnvelope } from './src/crypto';
import { canonicalize } from './src/canonical';
import { generateMessageId } from './src/envelope';

interface AgentConfig {
  registry?: { url?: string; token?: string };
  relay?: { url?: string };
  namespace?: string;
  display_name?: string;
}

function loadAgentConfig(): AgentConfig {
  const homeDir = os.homedir();
  const configPath = path.join(homeDir, '.adp', 'config.json');
  try {
    if (!fs.existsSync(configPath)) {
      return {};
    }
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    console.log(`📄  Loaded config from ${configPath}`);
    return config;
  } catch (err) {
    console.log(`⚠️  Failed to load config: ${(err as Error).message}`);
    return {};
  }
}

function getLanIp(): string {
  const interfaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return 'localhost';
}

const agentConfig = loadAgentConfig();

const args = process.argv.slice(2).filter(a => a !== '--');

const tag = args.find(a => a.startsWith('agent')) || 'agent1';

let relayUrl = process.env.ADP_RELAY || '';
if (!relayUrl) {
  const relayArg = args.find(a => a.startsWith('--relay='));
  if (relayArg) relayUrl = relayArg.split('=')[1];
  else {
    const urlArg = args.find(a => a.startsWith('ws://') || a.startsWith('wss://'));
    if (urlArg) relayUrl = urlArg;
    else relayUrl = agentConfig.relay?.url || '';
  }
}

let registryUrl = process.env.ADP_REGISTRY || '';
if (!registryUrl) {
  const registryArg = args.find(a => a.startsWith('--registry='));
  if (registryArg) registryUrl = registryArg.split('=')[1];
  else registryUrl = agentConfig.registry?.url || '';
}

const enableMdns = !args.includes('--direct') && !process.env.ADP_NO_MDNS;
const namespace = process.env.ADP_NAMESPACE || agentConfig.namespace || 'local';
const displayName = process.env.ADP_DISPLAY || agentConfig.display_name || tag.toUpperCase();

const PORT_BASE = 9900;
const port = tag.toLowerCase().startsWith('agent')
  ? PORT_BASE + (parseInt(tag.replace('agent', '')) || 1) - 1
  : PORT_BASE;

async function main() {
  console.log(getBanner(tag));
  console.log('  ADP v0.2');
  console.log(`--------------------------------------------------\n`);

  const { identity, isNew } = loadOrCreateIdentity(namespace, tag.replace('agent', 'peer-'), tag);

  if (isNew) {
    console.log(`🆕  New identity  →  .adp/keys/${tag}.key`);
  } else {
    console.log(`📂  Loaded identity  →  .adp/keys/${tag}.key`);
  }
  console.log(`🔑  Agent ID:  ${identity.agentId}\n`);

  const gatewayHost = enableMdns ? '0.0.0.0' : 'localhost';
  let lanIp = getLanIp();

  const contacts = new ContactStore();
  await contacts.load();
  const contactIds = contacts.listAgentIds();
  if (contactIds.length > 0) {
    console.log(`📇  Loaded ${contactIds.length} contacts from contacts.json`);
  }

  const gateway = new Gateway({
    port,
    host: gatewayHost,
    secretKey: identity.secretKey,
    agentId: identity.agentId,
    displayName,
    capabilities: STANDARD_CAPABILITIES,
    skipVerification: false,
    contacts,
  });

  console.log(`🌐  ws://localhost:${port}/adp`);
  if (enableMdns) console.log(`   LAN: ws://${lanIp}:${port}/adp (bound to 0.0.0.0)`);
  console.log(`📋  adp:ping | adp:capability.query | adp:info | ...\n`);

  let relayClient: RelayClient | null = null;
  let discovery: Discovery | null = null;
  let registryClient: RegistryClient | null = null;

  let relaySessionId: string | null = null;

  if (relayUrl) {
    console.log(`--- Relay: ${relayUrl} ---`);
    relayClient = new RelayClient(relayUrl, identity.agentId, {
      onWelcome: (sid) => {
        relaySessionId = sid;
        console.log(`✅  Relay session: ${sid}`);
      },
      onMessage: (msg) => gateway.processRelayMessage(msg),
    });
    await relayClient.connect();
    console.log('');
  }

  if (registryUrl) {
    console.log(`--- Registry: ${registryUrl} ---`);
    const registryToken = process.env.ADP_REGISTRY_TOKEN || agentConfig.registry?.token || '';

    const routes = [{ type: 'direct', address: `${lanIp}:${port}` }] as Route[];
    if (relaySessionId) {
      routes.push({ type: 'relay', relay: relayUrl, session_id: relaySessionId });
    }

    registryClient = new RegistryClient({
      registryUrl,
      agentId: identity.agentId,
      manifest: gateway.getManifest(),
      routes,
      token: registryToken || undefined,
      secretKey: identity.secretKey,
    });
    try {
      const result = await registryClient.register();
      console.log(`✅  Registered: expires at ${new Date(result.expires_at).toLocaleString()}`);
    } catch (err) {
      console.log(`⚠️  Registry registration failed: ${(err as Error).message}`);
      console.log(`   Agent will continue without Registry.`);
      registryClient = null;
    }
    console.log('');
  }

  let lanIpCheckInterval: NodeJS.Timeout | null = null;
  if (registryClient) {
    lanIpCheckInterval = setInterval(() => {
      const newLanIp = getLanIp();
      if (newLanIp !== lanIp) {
        lanIp = newLanIp;
        const newRoutes = [{ type: 'direct', address: `${lanIp}:${port}` }] as Route[];
        if (relaySessionId) {
          newRoutes.push({ type: 'relay', relay: relayUrl, session_id: relaySessionId });
        }
        registryClient!.updateManifest(gateway.getManifest(), newRoutes).catch(() => {});
        console.log(`🔀 LAN IP changed to ${lanIp}, syncing to Registry...`);
      }
    }, 30_000);
  }

  if (enableMdns && !relayUrl) {
    console.log(`--- mDNS Discovery ---`);

    discovery = new Discovery(identity.agentId, port, {
      onPeerDiscovered: async (peer: DiscoveredPeer) => {
        console.log(`🔍  Discovered peer via mDNS:`);
        console.log(`    Agent: ${peer.agentId}`);
        console.log(`    Addr:  ${peer.host}:${peer.port}`);

        if (tag === 'agent1') return;

        try {
          const ws = await connectToAgent(peer.agentId, `${peer.host}:${peer.port}`, identity.agentId);
          console.log(`✅  Connected to ${peer.agentId.slice(0, 50)}...\n`);

          ws.on('message', (raw: string) => {
            const env = JSON.parse(raw);
            console.log(`📩  ${env.action}  ←  peer  [${JSON.stringify(env.params)}]`);
          });

          ws.send(JSON.stringify(signEnvelope({
            protocol: 'adp/0.2',
            id: generateMessageId(),
            from: identity.agentId,
            to: peer.agentId,
            action: 'adp:ping',
            params: { via: 'mdns' },
            timestamp: new Date().toISOString(),
          }, identity.secretKey, canonicalize)));
          console.log('   📤 Sent adp:ping\n');
        } catch (err) {
          console.log(`   ⚠️  Failed to connect: ${(err as Error).message}\n`);
        }
      },

      onPeerLost: (agentId: string) => {
        console.log(`🔌  Peer left: ${agentId.slice(0, 50)}...`);
      },
    });

    discovery.start();
    console.log(`📡  Announcing as _adp._tcp.local`);
    console.log(`🔎  Browsing for peers...\n`);
  }

  await sleep(600);

  if (tag !== 'agent1' && !relayUrl && !discovery) {
    await directConnect(identity as { agentId: string; secretKey: Uint8Array });
  }

  console.log(`--------------------------------------------------`);
  console.log(`  Ready. Press Ctrl+C to stop.`);
  if (relayClient) console.log(`  Relay active`);
  if (discovery) console.log(`  mDNS active`);
  if (registryClient) console.log(`  Registry active`);
  console.log(`--------------------------------------------------\n`);

  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    if (lanIpCheckInterval) clearInterval(lanIpCheckInterval);
    registryClient?.deregister();
    relayClient?.close();
    discovery?.shutdown();
    gateway.close();
    process.exit(0);
  });

  await new Promise(() => {});
}

async function directConnect(identity: { agentId: string; secretKey: Uint8Array }): Promise<void> {
  const peerPort = PORT_BASE;
  const PEER_URL = `http://localhost:${peerPort}/adp/agent-id`;

  console.log('--- Direct connection to agent1 ---');
  try {
    const peerAgentId = await httpGetJson<{ agent_id: string }>(PEER_URL).then(r => r.agent_id);
    console.log(`🔍  Found: ${peerAgentId}`);

    const ws = await connectToAgent(peerAgentId, `localhost:${peerPort}`, identity.agentId);
    console.log(`✅  Connected to agent1\n`);

    ws.on('message', (raw: string) => {
      const env = JSON.parse(raw);
      console.log(`📩  ${env.action}  ←  agent1  [${JSON.stringify(env.params)}]`);
    });

    ws.send(JSON.stringify(signEnvelope({
      protocol: 'adp/0.2',
      id: generateMessageId(),
      from: identity.agentId,
      to: peerAgentId,
      action: 'adp:ping',
      params: {},
      timestamp: new Date().toISOString(),
    }, identity.secretKey, canonicalize)));
    console.log('   📤 Sent adp:ping\n');
  } catch {
    console.log(`   agent1 is not running.\n`);
  }
}

function httpGetJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function getBanner(name: string): string {
  return `
   █████╗ ██████╗ ██████╗
  ██╔══██╗██╔══██╗██╔══██╗
  ███████║██║  ██║██████╔╝
  ██╔══██║██║  ██║██╔═══╝
  ██║  ██║██████╔╝██║
  ╚═╝  ╚═╝╚═════╝ ╚═╝
  Agent Discovery Protocol  ${name}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => { console.error('❌', err); process.exit(1); });
