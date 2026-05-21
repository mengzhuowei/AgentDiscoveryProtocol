import { Relay } from './src/relay';

const port = parseInt(process.env.ADP_RELAY_PORT || '9700', 10);

const relay = new Relay({
  port,
  host: '0.0.0.0',
});

console.log(`
╔══════════════════════════════════════╗
║        ADP Relay Server              ║
╠══════════════════════════════════════╣
║  ws://localhost:${port}/adp/relay       ║
║                                      ║
║  Heartbeat: 15s / Timeout: 45s       ║
║  Offline cache: 24h / 500 msgs       ║
╚══════════════════════════════════════╝
`);

process.on('SIGINT', () => {
  console.log('\n👋 Relay shutting down...');
  relay.close();
  process.exit(0);
});
