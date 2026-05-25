#!/usr/bin/env node

import { loadOrCreateIdentity, RelayClient, buildEnvelope, signEnvelope, canonicalize } from './src';

console.log('🤖 Agent 2 启动中...');

async function main() {
  const { identity } = loadOrCreateIdentity('local', 'test-agent-2', 'tls-demo');
  
  console.log(`   Agent ID: ${identity.agentId}`);
  console.log(`   正在连接到 wss://localhost:9701/adp/relay...\n`);
  
  let targetAgentId: string | null = null;
  
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
        if (!targetAgentId) {
          targetAgentId = peerId;
          setTimeout(() => sendTestMessage(targetAgentId!), 1000);
        }
      } else {
        console.log(`👋 对等体离开: ${peerId.slice(0, 40)}...`);
      }
    },
    onClose: () => {
      console.log('\n❌ 连接已关闭');
    }
  }, { reconnect: false });
  
  async function sendTestMessage(toAgentId: string) {
    console.log(`\n📤 正在发送消息给 ${toAgentId.slice(0, 40)}...`);
    
    const envelope = buildEnvelope(
      identity.agentId,
      toAgentId,
      'adp:info',
      { message: 'Hello from Agent 2 via TLS! 你好，通过 TLS 加密的消息！' }
    );
    
    const signed = signEnvelope(envelope, identity.secretKey, canonicalize);
    client.send(toAgentId, signed);
    
    console.log('✅ 消息已发送！');
  }
  
  try {
    await client.connect();
    console.log('\nAgent 2 已连接！等待发现其他 Agent... (按 Ctrl+C 退出)');
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
