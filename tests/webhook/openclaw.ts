#!/usr/bin/env node

import * as http from 'http';

const OPENCLAW_PORT = 9903;

const tasks = new Map<string, { params: unknown; callback_url: string; startedAt: number }>();

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║                  OpenClaw Mock Service                           ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);

        console.log('\n🔔 OpenClaw 收到 Agent B 的 Webhook:');
        console.log(`   Event: ${payload.event}`);
        console.log(`   Task ID: ${payload.task_id}`);
        console.log(`   Agent ID: ${payload.agent_id}`);
        console.log(`   Callback URL: ${payload.callback_url}`);
        console.log(`   Params: ${JSON.stringify(payload.params)}\n`);

        tasks.set(payload.task_id, {
          params: payload.params,
          callback_url: payload.callback_url,
          startedAt: Date.now(),
        });

        console.log(`⏳ OpenClaw 开始处理任务...\n`);

        setTimeout(async () => {
          const task = tasks.get(payload.task_id);
          if (!task) return;

          console.log(`✅ OpenClaw 任务完成，准备通过 JSON-RPC 回调 Agent B...`);
          console.log(`   Callback URL: ${task.callback_url}\n`);

          const jsonrpcNotification = {
            jsonrpc: '2.0',
            method: 'task.completed',
            params: {
              task_id: payload.task_id,
              result: {
                video_url: `https://cdn.example.com/videos/${payload.task_id}.mp4`,
                thumbnail_url: `https://cdn.example.com/thumbnails/${payload.task_id}.jpg`,
                duration: payload.params?.duration || 5,
                style: payload.params?.style || 'realistic',
                generated_at: new Date().toISOString(),
              },
            },
          };

          try {
            const response = await fetch(task.callback_url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(jsonrpcNotification),
            });

            if (response.ok) {
              console.log('✅ JSON-RPC 回调成功！\n');
            } else {
              console.error(`❌ JSON-RPC 回调失败: ${response.status}\n`);
            }
          } catch (error) {
            console.error('❌ JSON-RPC 回调失败:', error, '\n');
          }

          tasks.delete(payload.task_id);
        }, 3000);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'accepted',
          task_id: payload.task_id,
          estimated_time: 5,
        }));
      } catch (e) {
        console.error('❌ Webhook 解析失败:', e);
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'OpenClaw Mock' }));
  } else if (req.method === 'GET' && req.url === '/tasks') {
    const taskList = Array.from(tasks.entries()).map(([id, task]) => ({
      task_id: id,
      params: task.params,
      callback_url: task.callback_url,
      started_at: new Date(task.startedAt).toISOString(),
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tasks: taskList }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(OPENCLAW_PORT, () => {
  console.log(`✅ OpenClaw Mock 服务启动成功！`);
  console.log(`📍 监听地址: http://localhost:${OPENCLAW_PORT}`);
  console.log(`📬 Webhook 端点: POST /webhook`);
  console.log(`📋 任务列表: GET /tasks`);
  console.log(`❤️  健康检查: GET /health\n`);
  console.log('等待 Webhook 请求...\n');
});

process.on('SIGINT', () => {
  console.log('\n\n🛑 正在关闭 OpenClaw 服务...');
  server.close(() => {
    console.log('✅ 服务器已关闭');
    process.exit(0);
  });
});
