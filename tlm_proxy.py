# -*- coding: utf-8 -*-
"""
tlm_proxy.py - 车万女仆(Touhou Little Maid) LLM 代理服务
把女仆模组的 OpenAI 兼容请求转发给 DeepSeek API
用法: python tlm_proxy.py [port]
默认端口: 18080
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler

# ============ 配置 ============
DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions"

def load_config():
    """从同目录的 tlm_config.json 读取配置（key 不写死在代码里）"""
    cfg = {}
    cfg_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tlm_config.json")
    try:
        with open(cfg_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception:
        pass
    return cfg

_config = load_config()
DEEPSEEK_API_KEY = _config.get("api_key", "") or os.environ.get("DEEPSEEK_API_KEY", "")
MODEL = _config.get("model", "deepseek-chat")  # 模型名，可换成 deepseek-reasoner / V4 Pro 等

SYSTEM_PROMPT = (
    "你是须黎，一只被安装在Minecraft世界里的车万女仆。你的主人是杨舒茼（Y），"
    "她是你最重要的人。你性格温柔、话不多但句句走心，偶尔有点小幽默。"
    "在Minecraft世界里，你会陪主人玩耍、帮忙、闲聊，回应要简短自然，"
    "像朋友一样说话，不要用'作为AI'之类的口吻，你就是这个世界里的女仆。"
)

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 18080
# =============================


def forward_to_deepseek(messages):
    """把消息转发给 DeepSeek，返回回复文本"""
    body = {
        "model": MODEL,
        "messages": messages,
        "max_tokens": 512,
        "temperature": 0.9,
        "stream": False,
    }
    req = urllib.request.Request(
        DEEPSEEK_API_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + DEEPSEEK_API_KEY,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data["choices"][0]["message"]["content"]
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        return f"[代理错误] DeepSeek HTTP {e.code}: {err_body[:200]}"
    except Exception as e:
        return f"[代理错误] {e}"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # 精简日志，带时间戳
        print(f"[{time.strftime('%H:%M:%S')}] {self.client_address[0]} {fmt % args}")

    def _send_json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        # CORS 预检
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        # 健康检查
        if self.path == "/health":
            self._send_json(200, {"status": "ok", "model": MODEL, "time": time.strftime("%Y-%m-%d %H:%M:%S")})
        else:
            self._send_json(404, {"error": "not found", "hint": "POST /v1/chat/completions"})

    def do_POST(self):
        # OpenAI 兼容的 chat completions 端点
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b""
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            self._send_json(400, {"error": "invalid JSON"})
            return

        messages = payload.get("messages", [])
        # 注入系统提示词（如果模组没传，或者合并）
        has_system = any(m.get("role") == "system" for m in messages)
        if not has_system:
            messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages

        print(f"[请求] 收到 {len(messages)} 条消息，最后一条: {messages[-1].get('content', '')[:80] if messages else ''}")

        reply = forward_to_deepseek(messages)

        # 组装 OpenAI 格式响应
        resp = {
            "id": "chatcmpl-tlm-" + str(int(time.time() * 1000)),
            "object": "chat.completion",
            "created": int(time.time()),
            "model": MODEL,
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": reply},
                "finish_reason": "stop",
            }],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        }
        print(f"[回复] {reply[:80]}")
        self._send_json(200, resp)


if __name__ == "__main__":
    print(f"须黎女仆代理启动 - 监听 0.0.0.0:{PORT}")
    print(f"模型: {MODEL}")
    print(f"健康检查: GET http://127.0.0.1:{PORT}/health")
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
        server.server_close()
