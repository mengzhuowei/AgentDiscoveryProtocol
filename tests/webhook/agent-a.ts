#!/usr/bin/env node

import { WebSocket } from 'ws';
import { loadOrCreateIdentity, signEnvelope, canonicalize, generateMessageId } from '../../src/index';

const AGENT_B_PORT = 9901;
const AGENT_A_PORT = 9904;

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║                    Agent A (任务请求方)                         ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

async function main() {
  const identity = loadOrCreateIdentity('test', 'agent-a', 'AgentA');
  const { identity: id } = identity;
  console.log(`🔑 Agent A ID: ${id.agentId}\n`);

  console.log(`🔌 连接到 Agent B: ws://localhost:${AGENT_B_PORT}/adp\n`);

  const ws = new WebSocket(`ws://localhost:${AGENT_B_PORT}/adp?agent_id=${encodeURIComponent(id.agentId)}`);

  ws.on('open', () => {
    console.log('✅ 已连接到 Agent B\n');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('发送视频生成请求给 Agent B');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    const requestEnvelope = signEnvelope({
      id: generateMessageId(),
      from: id.agentId,
      to: `adp://test@test/agent-b`,
      action: 'custom:video.generate',
      params: {
        prompt: 'A beautiful sunset over mountains with birds flying',
        duration: 10,
        style: 'cinematic',
      },
      timestamp: new Date().toISOString(),
    }, id.secretKey, canonicalize);

    console.log('📤 发送请求:');
    console.log(`   Action: ${requestEnvelope.action}`);
    console.log(`   Params: ${JSON.stringify(requestEnvelope.params)}\n`);

    ws.send(JSON.stringify(requestEnvelope));
  });

  ws.on('message', (data) => {
    const response = JSON.parse(data.toString());

    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('收到 Agent B 的响应');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    console.log('📨 响应详情:');
    console.log(`   Action: ${response.action}`);
    console.log(`   Params: ${JSON.stringify(response.params, null, 2)}\n`);

    const status = response.params?.status;
    const taskId = response.params?.task_id;

    if (status === 'PENDING') {
      console.log(`⏳ 任务已接受，等待完成... (Task ID: ${taskId})\n`);
    } else if (status === 'COMPLETED') {
      console.log('🎉 任务完成！');
      console.log('\n📊 结果:');
      console.log(`   视频 URL: ${response.params?.result?.video_url}`);
      console.log(`   缩略图: ${response.params?.result?.thumbnail_url}`);
      console.log(`   时长: ${response.params?.result?.duration}秒`);
      console.log(`   风格: ${response.params?.result?.style}`);
      console.log(`   生成时间: ${response.params?.result?.generated_at}\n`);

      console.log('═══════════════════════════════════════════════════════════════════');
      console.log('✅ 完整流程测试成功！');
      console.log('═══════════════════════════════════════════════════════════════════\n');

      setTimeout(() => {
        ws.close();
        process.exit(0);
      }, 1000);
    } else if (status === 'FAILED') {
      console.error('❌ 任务失败:', response.params?.error);
      process.exit(1);
    }
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket 错误:', error);
    process.exit(1);
  });

  ws.on('close', () => {
    console.log('\n🔌 连接已关闭\n');
  });
}

main().catch(console.error);
