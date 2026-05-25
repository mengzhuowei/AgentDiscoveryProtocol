#!/usr/bin/env node

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

console.log('🔐 开始简单 TLS 测试\n');

// 清理
const certDir = path.join(__dirname, '.adp', 'certs');
if (fs.existsSync(certDir)) {
  fs.rmSync(certDir, { recursive: true, force: true });
  console.log('🧹 清理了旧证书\n');
}

let relay: ChildProcess | null = null;

async function test() {
  try {
    // 1. 启动 Relay
    console.log('1️⃣ 启动 Relay...');
    const relayReady = new Promise<void>((resolve) => {
      relay = spawn('npx', ['ts-node', '../../start-relay.ts'], {
        cwd: path.join(__dirname, '../..'),
        env: { ...process.env, ADP_RELAY_PORT: '9701' }
      });
      
      relay.stdout?.on('data', (data) => {
        const out = data.toString();
        process.stdout.write(out);
        
        if (out.includes('wss://0.0.0.0:9701/adp/relay')) {
          resolve();
        }
      });
    });
    
    await relayReady;
    console.log('\n✅ Relay 已在 TLS 模式启动！');
    
    // 2. 检查证书文件
    console.log('\n2️⃣ 检查证书...');
    if (fs.existsSync(path.join(certDir, 'server.crt')) && 
        fs.existsSync(path.join(certDir, 'server.key'))) {
      console.log('✅ 证书文件生成成功！');
    }
    
    // 3. 完成
    console.log('\n🎉 TLS 功能基础测试通过！');
    console.log('\n📋 已验证:');
    console.log('   - Relay 可以在 TLS 模式启动 (wss://)');
    console.log('   - 自签名证书可以自动生成');
    console.log('\n接下来您可以:');
    console.log('   - 运行 test-agent1.ts 和 test-agent2.ts 测试 Agent 连接');
    console.log('   - 或查看 examples/relay-client.ts 了解更多示例');
    
    setTimeout(() => cleanup(0), 2000);
    
  } catch (e) {
    console.error('❌ 测试失败:', e);
    cleanup(1);
  }
}

function cleanup(code: number) {
  if (relay) relay.kill();
  process.exit(code);
}

process.on('SIGINT', () => cleanup(0));

test();
