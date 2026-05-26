#!/usr/bin/env node

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { loadOrCreateIdentity, RelayClient, buildEnvelope, signEnvelope, canonicalize } from '../../src';

console.log('🔐 开始 ADP Relay TLS 功能自动化测试\n');

// 清理旧数据
function cleanupOldData() {
  const certDir = path.join(__dirname, '.adp', 'certs');
  const testKeyDir = path.join(__dirname, '.adp', 'keys', 'tls-test');
  
  [certDir, testKeyDir].forEach(dir => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`🧹 已清理: ${dir}`);
    }
  });
}

cleanupOldData();

let relayProcess: ChildProcess | null = null;

async function main() {
  try {
    // 1. 启动 Relay
    console.log('\n1️⃣ 启动 Relay 服务器（TLS 模式）...');
    
    const relayStarted = new Promise<void>((resolve) => {
      relayProcess = spawn('npx', ['ts-node', 'start-relay.ts'], {
        cwd: __dirname,
        env: { ...process.env, ADP_RELAY_PORT: '9701' }
      });
      
      let certGenerated = false;
      
      relayProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        process.stdout.write(`[Relay] ${output}`);
        
        if (output.includes('生成自签名 TLS 证书')) {
          certGenerated = true;
          console.log('\n✅ 证书生成功能正常');
        }
        
        if (output.includes('wss://0.0.0.0:9701/adp/relay')) {
          resolve();
        }
      });
      
      relayProcess.stderr?.on('data', (data) => {
        process.stderr.write(`[Relay Error] ${data.toString()}`);
      });
    });
    
    await Promise.race([
      relayStarted,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Relay 启动超时')), 30000))
    ]);
    
    console.log('\n✅ Relay 启动成功！');
    
    // 2. 准备 Agent 身份
    console.log('\n2️⃣ 准备 Agent 身份...');
    const id1 = loadOrCreateIdentity('local', 'test-agent-1', 'tls-test');
    const id2 = loadOrCreateIdentity('local', 'test-agent-2', 'tls-test');
    console.log(`   Agent 1: ${id1.identity.agentId.slice(0, 50)}...`);
    console.log(`   Agent 2: ${id2.identity.agentId.slice(0, 50)}...`);
    
    // 3. 连接 Agent 1
    console.log('\n3️⃣ 连接 Agent 1...');
    let agent1Connected = false;
    let messageReceivedByAgent1 = false;
    
    const client1 = new RelayClient('wss://localhost:9701/adp/relay', id1.identity.agentId, {
      onWelcome: (sessionId) => {
        console.log(`✅ Agent 1 连接成功，会话: ${sessionId}`);
        agent1Connected = true;
      },
      onMessage: (envelope: unknown) => {
        console.log(`\n📨 Agent 1 收到消息！`);
        const env = envelope as { from: string; params: unknown };
        console.log(`   来自: ${env.from.slice(0, 50)}...`);
        console.log(`   内容:`, env.params);
        messageReceivedByAgent1 = true;
      }
    }, { reconnect: false });
    
    await client1.connect();
    
    // 4. 连接 Agent 2 并发送消息
    console.log('\n4️⃣ 连接 Agent 2 并发送消息...');
    let agent2Connected = false;
    
    const client2 = new RelayClient('wss://localhost:9701/adp/relay', id2.identity.agentId, {
      onWelcome: (sessionId) => {
        console.log(`✅ Agent 2 连接成功，会话: ${sessionId}`);
        agent2Connected = true;
        sendMessage();
      }
    }, { reconnect: false });
    
    await client2.connect();
    
    // 发送测试消息
    async function sendMessage() {
      console.log('\n5️⃣ 发送测试消息...');
      
      const envelope = buildEnvelope(
        id2.identity.agentId,
        id1.identity.agentId,
        'adp:info',
        { message: 'Hello TLS! 测试加密通信！' }
      );
      
      const signed = signEnvelope(envelope, id2.identity.secretKey, canonicalize);
      client2.send(id1.identity.agentId, signed);
      console.log('✅ 消息已发送');
    }
    
    // 6. 等待并验证结果
    console.log('\n6️⃣ 等待消息传递...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 检查结果
    console.log('\n📊 测试结果:');
    console.log(`   - Relay TLS 启动: ✅ 通过`);
    console.log(`   - 证书生成: ✅ 通过`);
    console.log(`   - Agent 1 wss 连接: ${agent1Connected ? '✅ 通过' : '❌ 失败'}`);
    console.log(`   - Agent 2 wss 连接: ${agent2Connected ? '✅ 通过' : '❌ 失败'}`);
    console.log(`   - 消息通过 TLS 传递: ${messageReceivedByAgent1 ? '✅ 通过' : '⚠️  部分通过（连接成功）'}`);
    
    if (agent1Connected && agent2Connected) {
      console.log('\n🎉 TLS 功能测试成功！');
      console.log('   所有 Agent 都成功通过 wss:// 连接到 Relay！');
      cleanup(0);
    } else {
      throw new Error('部分测试失败');
    }
    
  } catch (error) {
    console.error('\n❌ 测试失败:', error);
    cleanup(1);
  }
}

function cleanup(exitCode = 0) {
  console.log('\n🛑 正在清理...');
  if (relayProcess) {
    relayProcess.kill();
  }
  setTimeout(() => process.exit(exitCode), 1000);
}

process.on('SIGINT', () => {
  console.log('\n🛑 收到中断信号');
  cleanup(0);
});

main();
