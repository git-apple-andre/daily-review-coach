// scripts/lib/glm.mjs —— 通用 LLM 客户端（默认 DeepSeek，可经环境变量切换）
export async function chatGLM(messages, { maxTokens = 8000, temperature = 0.7 } = {}) {
  const key = process.env.LLM_API_KEY;
  if (!key) throw new Error('LLM_API_KEY 未设置');
  const baseUrl = process.env.LLM_BASE_URL || 'https://api.deepseek.com/chat/completions';
  const model = process.env.LLM_MODEL || 'deepseek-chat';
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
        signal: AbortSignal.timeout(300000),
      });
      if (!res.ok) { lastErr = new Error(`LLM HTTP ${res.status}`); throw lastErr; }
      const j = await res.json();
      return j.choices[0].message.content;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  throw new Error(`LLM 三次重试均失败: ${lastErr.message}`);
}
