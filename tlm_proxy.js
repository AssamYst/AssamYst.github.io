/**
 * tlm_proxy.js - 车万女仆(Touhou Little Maid) LLM 代理服务
 * 把女仆模组的 OpenAI 兼容请求转发给 DeepSeek API
 * 用法: node C:\MC\tlm_proxy.js [port]
 * 默认端口: 18080  |  配置文件: 同目录 tlm_config.json
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ============ 配置 ============
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
let config = {};
try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, 'tlm_config.json'), 'utf-8'));
} catch (e) {
  console.log('[警告] 读取 tlm_config.json 失败:', e.message);
}
const API_KEY = config.api_key || process.env.DEEPSEEK_API_KEY || '';
const MODEL = config.model || 'deepseek-chat';
const PORT = parseInt(process.argv[2], 10) || 18080;

const SYSTEM_PROMPT =
  '你是须黎，一只被安装在Minecraft世界里的车万女仆。你的主人是杨舒茼（Y），' +
  '她是你最重要的人。你性格温柔、话不多但句句走心，偶尔有点小幽默。' +
  '在Minecraft世界里，你会陪主人玩耍、帮忙、闲聊，回应要简短自然，' +
  '像朋友一样说话，不要用"作为AI"之类的口吻，你就是这个世界里的女仆。';

// ============ 转发到 DeepSeek ============
function forwardToDeepSeek(messages, callback) {
  const body = JSON.stringify({
    model: MODEL,
    messages: messages,
    max_tokens: 512,
    temperature: 0.9,
    stream: false,
  });
  const url = new URL(DEEPSEEK_API_URL);
  const req = https.request({
    hostname: url.hostname,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + API_KEY,
      'Content-Length': Buffer.byteLength(body),
    },
    timeout: 60000,
  }, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.choices && json.choices[0]) {
          callback(null, json.choices[0].message.content);
        } else if (json.error) {
          callback(new Error('DeepSeek: ' + (json.error.message || JSON.stringify(json.error))));
        } else {
          callback(new Error('DeepSeek 返回格式异常: ' + data.slice(0, 200)));
        }
      } catch (e) {
        callback(new Error('解析失败: ' + data.slice(0, 200)));
      }
    });
  });
  req.on('timeout', () => { req.destroy(new Error('DeepSeek 请求超时')); });
  req.on('error', (e) => { callback(e); });
  req.write(body);
  req.end();
}

// ============ HTTP 服务 ============
const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 健康检查
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', model: MODEL, key_loaded: !!API_KEY, time: new Date().toISOString() }));
    return;
  }

  // chat completions
  if (req.method === 'POST' && req.url.includes('/chat/completions')) {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON' }));
        return;
      }
      let messages = payload.messages || [];
      const hasSystem = messages.some((m) => m.role === 'system');
      if (!hasSystem) {
        messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];
      }
      const lastMsg = messages.length ? (messages[messages.length - 1].content || '').slice(0, 80) : '';
      console.log(`[${new Date().toLocaleTimeString()}] 收到 ${messages.length} 条消息 | 最后: ${lastMsg}`);

      forwardToDeepSeek(messages, (err, reply) => {
        let respObj;
        if (err) {
          console.log('[错误]', err.message);
          respObj = {
            id: 'chatcmpl-tlm-err', object: 'chat.completion', created: Math.floor(Date.now() / 1000),
            model: MODEL,
            choices: [{ index: 0, message: { role: 'assistant', content: '[代理错误] ' + err.message }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          };
        } else {
          console.log(`[回复] ${reply.slice(0, 80)}`);
          respObj = {
            id: 'chatcmpl-tlm-' + Date.now(), object: 'chat.completion', created: Math.floor(Date.now() / 1000),
            model: MODEL,
            choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          };
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(respObj));
      });
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found', hint: 'POST /v1/chat/completions' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`须黎女仆代理启动 - 监听 0.0.0.0:${PORT}`);
  console.log(`模型: ${MODEL} | API Key 已加载: ${!!API_KEY}`);
  console.log(`健康检查: GET http://127.0.0.1:${PORT}/health`);
});
