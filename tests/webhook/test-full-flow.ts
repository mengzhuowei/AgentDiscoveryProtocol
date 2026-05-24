#!/usr/bin/env node

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');

console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║          ADP Webhook 完整流程测试                                           ║');
console.log('║                                                                              ║');
console.log('║  Agent A ──(WebSocket)──> Agent B ──(Webhook)──> OpenClaw                   ║');
console.log('║     ^                           │                                            ║');
console.log('║     │                           │ (JSON-RPC)                                 ║');
console.log('║     │                           │                                            ║');
console.log('║     └────────(WebSocket)────────┘                                            ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

let openclawProc: ChildProcess | null = null;
let agentBProc: ChildProcess | null = null;
let agentAProc: ChildProcess | null = null;

function killAll() {
  const procs = [openclawProc, agentBProc, agentAProc];
  procs.forEach(p => {
    if (p && !p.killed) {
      p.kill('SIGTERM');
    }
  });
  process.exit(0);
}

process.on('SIGINT', killAll);
process.on('SIGTERM', killAll);

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(port: number, name: string, maxRetries = 30): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`http://localhost:${port}/health`);
      if (response.ok) {
        console.log(`✅ ${name} 已就绪 (端口 ${port})\n`);
        return;
      }
    } catch {
      // 等待中...
    }
    await sleep(500);
  }
  throw new Error(`${name} 启动超时`);
}

async function main() {
  console.log('🚀 启动测试服务...\n');

  console.log('📦 启动 OpenClaw Mock 服务...');
  openclawProc = spawn('npx', ['ts-node', 'tests/webhook/openclaw.ts'], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  openclawProc.stdout?.on('data', (data) => {
    process.stdout.write(data.toString().replace(/^/gm, '  [OpenClaw] '));
  });
  openclawProc.stderr?.on('data', (data) => {
    process.stderr.write(data.toString().replace(/^/gm, '  [OpenClaw] '));
  });

  await sleep(1000);
  await waitForServer(9903, 'OpenClaw');

  console.log('📦 启动 Agent B...');
  agentBProc = spawn('npx', ['ts-node', 'tests/webhook/agent-b.ts'], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  agentBProc.stdout?.on('data', (data) => {
    process.stdout.write(data.toString().replace(/^/gm, '  [Agent B] '));
  });
  agentBProc.stderr?.on('data', (data) => {
    process.stderr.write(data.toString().replace(/^/gm, '  [Agent B] '));
  });

  await sleep(1000);
  await waitForServer(9902, 'Agent B HTTP');

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('开始测试流程');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('📦 启动 Agent A...');
  agentAProc = spawn('npx', ['ts-node', 'tests/webhook/agent-a.ts'], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  agentAProc.stdout?.on('data', (data) => {
    process.stdout.write(data.toString().replace(/^/gm, '  [Agent A] '));
  });
  agentAProc.stderr?.on('data', (data) => {
    process.stderr.write(data.toString().replace(/^/gm, '  [Agent A] '));
  });

  await sleep(8000);

  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('测试完成，清理资源...\n');

  killAll();
}

main().catch((error) => {
  console.error('测试失败:', error);
  killAll();
});
