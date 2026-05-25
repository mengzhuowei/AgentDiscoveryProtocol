#!/usr/bin/env node

import { loadOrCreateIdentity, RelayClient } from './src';

console.log('🤖 Agent 1 启动中...');

async function main() {
  const { identity } = loadOrCreateIdentity('local', 'test-agent-1', 'tls-demo');
  
  console.log(`   Agent ID: ${identity.agentId}`);
  console.log(`   正在连接到 wss://localhost:9701/adp/relay...\n`);
  
  const client = new RelayClient('wss://localhost:9701/adp/relay', identity.agentId, {
    onWelcome: (sessionId) => {
      console.log(`✅ 连接成功！会话 ID: ${sessionId}`);
    },
    onMessage: (envelope) => {
      console.log(`\n📨 收到消息:`);
      console.log(`   来自: ${envelope.from}`);
      console.log(`   内容:`, envelope.params);
    },
    onPeerUpdate: (type, peerId) => {
      if (type === 'peer_joined') {
        console.log(`👋 新对等体加入: ${peerId.slice(0, 40)}...`);
      } else {
        console.log(`👋 对等体离开: ${peerId.slice(0, 40)}...`);
      }
    },
    onClose: () => {
      console.log('\n❌ 连接已关闭');
    }
  }, { reconnect: false });
  
  try {
    await client.connect();
    console.log('\nAgent 1 已连接并等待消息... (按 Ctrl+C 退出)');
  } catch (error) {
    console.error('\n❌ 连接失败:', error);
    process.exit(1);
  }
}

main();

process.on('SIGINT', () => {
  console.log('\n👋 正在退出...');
  process.exit(0);
});
