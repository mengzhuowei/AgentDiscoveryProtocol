#!/usr/bin/env node
import { AdpMcpServer } from './src/mcp-server';
import { type Capability } from './src/manifest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

function loadMcpConfig(): Record<string, unknown> {
  const candidates = [
    path.join(process.cwd(), '.adp', 'config.json'),
    path.join(os.homedir(), '.adp', 'config.json'),
  ];
  for (const cp of candidates) {
    try {
      if (!fs.existsSync(cp)) continue;
      return JSON.parse(fs.readFileSync(cp, 'utf-8'));
    } catch {}
  }
  return {};
}

const rawArgs = process.argv.slice(2);
const args = rawArgs.filter(a => a !== '--');

const tag = args.find(a => !a.startsWith('--')) || 'agent1';

const cfg = loadMcpConfig() as Record<string, unknown>;
const rc = (cfg.relay as Record<string, string> | undefined) || {};
const rg = (cfg.registry as Record<string, string> | undefined) || {};

let relayUrl = process.env.ADP_RELAY || '';
if (!relayUrl) {
  const relayArg = args.find(a => a.startsWith('--relay='));
  if (relayArg) relayUrl = relayArg.split('=')[1];
  else relayUrl = rc.url || '';
}

let registryUrl = process.env.ADP_REGISTRY || '';
if (!registryUrl) {
  const registryArg = args.find(a => a.startsWith('--registry='));
  if (registryArg) registryUrl = registryArg.split('=')[1];
  else registryUrl = rg.url || '';
}

const registryToken = process.env.ADP_REGISTRY_TOKEN || rg.token || '';

const namespace = process.env.ADP_NAMESPACE || String(cfg.namespace || 'local');

let agentName = process.env.ADP_NAME || '';
if (!agentName) {
  const nameArg = args.find(a => a.startsWith('--name='));
  if (nameArg) agentName = nameArg.split('=')[1];
  else agentName = String(cfg.name || '');
}

const displayName = cfg.displayName as string | undefined;
const capabilities = cfg.capabilities as (string | Capability)[] | undefined;
const description = cfg.description as string | undefined;
const portBase = cfg.portBase as number | undefined;
const communication = cfg.communication as Record<string, unknown> | undefined;

const server = new AdpMcpServer({
  tag,
  namespace,
  agentName,
  relayUrl: relayUrl || undefined,
  registryUrl: registryUrl || undefined,
  registryToken: registryToken || undefined,
  displayName,
  capabilities,
  description,
  portBase,
  communication: communication as any,
});

process.stderr.write(`[ADP-MCP] Starting with tag=${tag}\n`);

process.on('SIGINT', async () => {
  process.stderr.write('[ADP-MCP] Shutting down...\n');
  await server.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  process.stderr.write('[ADP-MCP] Shutting down...\n');
  await server.shutdown();
  process.exit(0);
});

async function main() {
  await server.start();
  await server.connect();
  process.stderr.write('[ADP-MCP] Ready\n');
}

main().catch((err) => {
  process.stderr.write(`[ADP-MCP] Fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
