import { Relay } from './src/relay';

const port = parseInt(process.env.ADP_RELAY_PORT || process.env.RELAY_PORT || '9700', 10);
const host = process.env.ADP_RELAY_HOST || process.env.RELAY_HOST || '0.0.0.0';
const maxConnections = parseInt(process.env.ADP_RELAY_MAX_CONNECTIONS || process.env.RELAY_MAX_CONNECTIONS || '10000', 10);
const heartbeatIntervalMs = parseInt(process.env.ADP_RELAY_HEARTBEAT_INTERVAL_MS || process.env.RELAY_HEARTBEAT_INTERVAL_MS || '15000', 10);
const heartbeatTimeoutMs = parseInt(process.env.ADP_RELAY_HEARTBEAT_TIMEOUT_MS || process.env.RELAY_HEARTBEAT_TIMEOUT_MS || '45000', 10);
const offlineMaxAgeMs = parseInt(process.env.ADP_RELAY_OFFLINE_MAX_AGE_MS || process.env.RELAY_OFFLINE_MAX_AGE_MS || '86400000', 10);
const offlineMaxPerAgent = parseInt(process.env.ADP_RELAY_OFFLINE_MAX_PER_AGENT || process.env.RELAY_OFFLINE_MAX_PER_AGENT || '500', 10);

const relay = new Relay({
  port,
  host,
  maxConnections,
  heartbeatIntervalMs,
  heartbeatTimeoutMs,
  offlineMaxAgeMs,
  offlineMaxPerAgent,
});

console.log(`
╔══════════════════════════════════════╗
║        ADP Relay Server              ║
╠══════════════════════════════════════╣
║  ws://${host}:${port}/adp/relay       ║
║                                      ║
║  Heartbeat: ${heartbeatIntervalMs / 1000}s / Timeout: ${heartbeatTimeoutMs / 1000}s       ║
║  Offline cache: ${offlineMaxAgeMs / 86400000}d / ${offlineMaxPerAgent} msgs       ║
╚══════════════════════════════════════╝
`);

process.on('SIGINT', () => {
  console.log('\n👋 Relay shutting down...');
  relay.close();
  process.exit(0);
});