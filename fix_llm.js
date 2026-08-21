// fix_llm.js - 往车万女仆 llm.json 添加"ke"站点（指向本地代理）
const fs = require('fs');
const path = 'C:/MC/.minecraft/versions/neoforge-21.1.248/config/touhou_little_maid/sites/llm.json';

try {
  // 备份
  fs.copyFileSync(path, path + '.bak');
  console.log('已备份: llm.json.bak');

  const data = JSON.parse(fs.readFileSync(path, 'utf-8'));

  // 添加我们的站点
  data.ke = {
    id: 'ke',
    api_type: 'openai',
    enabled: true,
    icon: 'touhou_little_maid:textures/gui/ai_chat/player2.png',
    url: 'http://127.0.0.1:18080/v1/chat/completions',
    secret_key: 'ke4y-proxy',
    headers: {},
    models: ['default', 'deepseek-chat']
  };

  fs.writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
  console.log('OK - 站点 ke 已添加');
  console.log('url:', data.ke.url);
  console.log('enabled:', data.ke.enabled);
} catch (e) {
  console.log('错误:', e.message);
  process.exit(1);
}
