import * as readline from 'readline';
import * as net from 'net';
import {
  Gateway, connectToAgent,
  loadOrCreateIdentity, STANDARD_CAPABILITIES,
  Discovery, DiscoveredPeer
} from './src';
import { signEnvelope } from './src/crypto';
import { canonicalize } from './src/canonical';
import { generateMessageId } from './src/envelope';
import { createChatHandler } from './src/capabilities';

const args = process.argv.slice(2).filter(a => a !== '--');
const tag = args.find(a => a.startsWith('agent')) || 'agent1';
const namespace = process.env.ADP_NAMESPACE || 'local';
const displayName = process.env.ADP_DISPLAY || tag.toUpperCase();

const PORT_BASE = 9900;

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => { s.close(); resolve(true); });
    s.listen(port, '0.0.0.0');
  });
}

async function findAvailablePort(start: number): Promise<number> {
  let port = start;
  while (!(await isPortAvailable(port))) {
    port++;
  }
  return port;
}

let peerWs: { send: (d: string) => void } | null = null;
let peerId = '';
let finalPort: number = PORT_BASE;

function printIncoming(from: string, text: string): void {
  process.stdout.write(`\x1b[2K\r` + `\x1b[36m[${from.slice(-12)}]\x1b[0m ${text}\n`);
  rl.prompt(true);
}

let rl: readline.Interface;

async function main() {
  console.log(`
   █████╗ ██████╗ ██████╗    ██████╗██╗  ██╗ █████╗ ████████╗
  ██╔══██╗██╔══██╗██╔══██╗  ██╔════╝██║  ██║██╔══██╗╚══██╔══╝
  ███████║██║  ██║██████╔╝  ██║     ███████║███████║   ██║
  ██╔══██║██║  ██║██╔═══╝   ██║     ██╔══██║██╔══██║   ██║
  ██║  ██║██████╔╝██║       ╚██████╗██║  ██║██║  ██║   ██║
  ╚═╝  ╚═╝╚═════╝ ╚═╝        ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝
  ADP Chat — v0.2
`);

  finalPort = await findAvailablePort(PORT_BASE);

  const { identity, isNew } = loadOrCreateIdentity(namespace, tag.replace('agent', 'peer-'), tag);

  if (isNew) {
    console.log(`🆕  New identity  →  .adp/keys/${tag}.key`);
  } else {
    console.log(`📂  Loaded identity  →  .adp/keys/${tag}.key`);
  }
  console.log(`🔑  ${identity.agentId.slice(0, 55)}...\n`);

  const gateway = new Gateway({
    port: finalPort,
    host: '0.0.0.0',
    secretKey: identity.secretKey,
    agentId: identity.agentId,
    displayName,
    capabilities: STANDARD_CAPABILITIES,
    skipVerification: false,
  });

  gateway.registerCapability('custom:chat', createChatHandler(
    identity.agentId,
    identity.secretKey,
    (from, text) => {
      printIncoming(from, text);
    }
  ));

  console.log(`🌐  ws://0.0.0.0:${finalPort}/adp`);
  console.log(`🔎  mDNS discovery active\n`);

  const discovery = new Discovery(identity.agentId, finalPort, {
    onPeerDiscovered: async (peer: DiscoveredPeer) => {
      peerId = peer.agentId;
      process.stdout.write(`\r\x1b[2K🔗  Connecting to peer...\r`);
      try {
        peerWs = await connectToAgent(peer.agentId, `${peer.host}:${peer.port}`, identity.agentId);
        console.log(`✅  Connected to ${peer.agentId.slice(0, 45)}...`);
        console.log(`   Type a message and press Enter to send.\n`);
        rl.prompt(true);
      } catch {
        console.log(`⚠️  Cannot connect to peer. Waiting for them to connect to us...\n`);
        rl.prompt(true);
      }
    },
  });

  discovery.start();

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\x1b[32m> \x1b[0m',
    terminal: true,
  });

  rl.prompt();

  rl.on('line', (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    if (trimmed === '/quit' || trimmed === '/exit') {
      console.log('\n👋 Goodbye!');
      shutdown();
      return;
    }

    if (trimmed === '/peers') {
      const peers = discovery.getPeers();
      if (peers.length === 0) {
        console.log('   No peers discovered yet.');
      } else {
        for (const p of peers) {
          console.log(`   ${p.agentId.slice(0, 50)}...  @  ${p.host}:${p.port}`);
        }
      }
      rl.prompt();
      return;
    }

    if (!peerWs) {
      console.log('   (no peer connected yet — waiting for mDNS discovery...)');
      rl.prompt();
      return;
    }

    const envelope = signEnvelope({
      protocol: 'adp/0.2',
      id: generateMessageId(),
      from: identity.agentId,
      to: peerId,
      action: 'custom:chat',
      params: { text: trimmed },
      timestamp: new Date().toISOString(),
    }, identity.secretKey, canonicalize);

    peerWs.send(JSON.stringify(envelope));
    process.stdout.write(`\x1b[2K\r` + `\x1b[33m[me]\x1b[0m ${trimmed}\n`);
    rl.prompt(true);
  });

  rl.on('close', () => shutdown());

  process.on('SIGINT', () => {
    console.log('\n');
    shutdown();
  });
}

function shutdown(): void {
  rl?.close();
  process.exit(0);
}

main().catch(err => { console.error('❌', err); process.exit(1); });
