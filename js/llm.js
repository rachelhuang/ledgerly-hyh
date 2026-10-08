// OpenAI-compatible LLM client. Same logic as iOS LLMService.
import { Settings } from './settings.js';

function commonSystemPrompt() {
  const nowISO = new Date().toISOString();
  return `你是一个消费记录提取助手。请从用户的输入（自然语言或图片）中提取消费信息，并以严格的 JSON 格式返回。

当前时间（参考）：${nowISO}

【最高优先级】你的回复必须是且只能是一个合法的 JSON 对象，禁止任何额外的文字、解释、Markdown 代码块或前后缀。

JSON 结构如下：
{
  "timestamp": "ISO 8601 格式的时间字符串，例如 2026-09-14T12:30:00+08:00",
  "category": "消费类型，常见类别：餐饮、交通、购物、娱乐、住房、医疗、教育、其他",
  "amount": 数字（消费金额，正数，不带货币符号）,
  "description": "用中文简洁描述这次消费，10 字以内"
}

规则：
1. 如果没有明确时间，使用当前时间。
2. 相对时间（昨天、上周五、3 天前等）根据当前时间推算。
3. amount 必须是数字（不要写成 "128元" 或 "￥128"），单位统一为人民币元。
4. category 从常见类别中选择最合适的一个，无法识别填 "其他"。
5. description 用中文描述，不要重复金额。
6. 不要输出任何 markdown，不要用 \`\`\`json 包裹，直接输出 JSON。`;
}

async function request({ messages, imageBase64 }) {
  const cfg = Settings.config;
  const base = cfg.baseURL.replace(/\/$/, '');
  const url = `${base}/chat/completions`;

  let userContent;
  if (imageBase64) {
    userContent = [
      { type: 'text', text: '这张图片是消费凭证（可能是小票、订单截图、发票、转账记录等）。请仔细识别金额、消费时间、消费类型与消费描述。' },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
    ];
  } else {
    userContent = messages[1].content;
  }

  const body = {
    model: cfg.model,
    messages: imageBase64
      ? [
          { role: 'system', content: commonSystemPrompt() },
          { role: 'user', content: userContent }
        ]
      : messages,
    temperature: 0.1
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`LLM HTTP 错误 (${resp.status})：${txt.slice(0, 300)}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM 返回为空');
  return content;
}

function stripCodeFence(s) {
  let t = s.trim();
  if (t.startsWith('```')) {
    const nl = t.indexOf('\n');
    t = nl >= 0 ? t.slice(nl + 1) : t.slice(3);
    if (t.endsWith('```')) t = t.slice(0, -3);
    t = t.trim();
  }
  return t;
}

function extractJSON(s) {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inString = false, escape = false, endIdx = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
  }
  if (endIdx < 0) return null;
  return s.slice(start, endIdx + 1);
}

function parse(raw) {
  const cleaned = stripCodeFence(raw);
  const json = cleaned.startsWith('{') ? cleaned : (extractJSON(cleaned) || cleaned);
  try {
    return JSON.parse(json);
  } catch (e) {
    throw new Error('LLM 返回无法解析：' + json.slice(0, 300));
  }
}

export async function extractExpenseFromText(text) {
  const messages = [
    { role: 'system', content: commonSystemPrompt() },
    { role: 'user', content: text }
  ];
  const raw = await request({ messages });
  return parse(raw);
}

export async function extractExpenseFromImage(base64) {
  const raw = await request({ imageBase64: base64 });
  return parse(raw);
}

export async function testConnection() {
  const messages = [
    { role: 'system', content: commonSystemPrompt() },
    { role: 'user', content: '测试：今天买咖啡 30 元' }
  ];
  const raw = await request({ messages });
  return parse(raw);
}
