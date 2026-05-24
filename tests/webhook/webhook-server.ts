#!/usr/bin/env node

import * as http from 'http';

interface WebhookPayload {
  event: string;
  task_id: string;
  agent_id: string;
  timestamp: string;
  signature: string;
  data: {
    result?: unknown;
    error?: {
      code: string;
      message: string;
    };
    progress?: {
      current: number;
      total: number;
      message: string;
    };
  };
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        const payload: WebhookPayload = JSON.parse(body);
        
        console.log('\n========================================');
        console.log('📬 Webhook 收到请求！');
        console.log('========================================');
        console.log('Event:', payload.event);
        console.log('Task ID:', payload.task_id);
        console.log('Agent ID:', payload.agent_id);
        console.log('Timestamp:', payload.timestamp);
        console.log('Signature:', payload.signature ? '已提供' : '未提供');
        console.log('----------------------------------------');
        console.log('Data:', JSON.stringify(payload.data, null, 2));
        console.log('========================================\n');
        
        const signature = req.headers['x-webhook-signature'];
        const event = req.headers['x-webhook-event'];
        const taskId = req.headers['x-webhook-task-id'];
        
        console.log('Headers:');
        console.log('  X-Webhook-Signature:', signature || 'N/A');
        console.log('  X-Webhook-Event:', event || 'N/A');
        console.log('  X-Webhook-Task-Id:', taskId || 'N/A');
        console.log('');
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          status: 'ok', 
          message: 'Webhook received',
          event: payload.event,
          task_id: payload.task_id
        }));
        
      } catch (error) {
        console.error('❌ 解析 Webhook 请求失败:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const PORT = process.env.WEBHOOK_PORT || 8080;

server.listen(PORT, () => {
  console.log(`✅ Webhook 服务器启动成功！`);
  console.log(`📍 监听地址: http://localhost:${PORT}`);
  console.log(`📬 Webhook 端点: POST /webhook`);
  console.log(`❤️  健康检查: GET /health`);
  console.log('');
  console.log('等待接收 Webhook 请求...\n');
});

process.on('SIGINT', () => {
  console.log('\n\n🛑 正在关闭 Webhook 服务器...');
  server.close(() => {
    console.log('✅ 服务器已关闭');
    process.exit(0);
  });
});
