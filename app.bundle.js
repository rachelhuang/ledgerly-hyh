// === js/db.js ===
// IndexedDB wrapper for Ledgerly expense records.
// Replaces SwiftData @Model storage in the iOS app.

const DB_NAME = 'ledgerly';
const DB_VERSION = 1;
const STORE = 'expenses';

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(mode = 'readonly') {
  return openDB().then((db) => {
    const t = db.transaction(STORE, mode);
    return t.objectStore(STORE);
  });
}

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

async function add(record) {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.add(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

async function put(record) {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

async function remove(id) {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getAll() {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function clear() {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

window.DB = { uid, add, put, remove, getAll, clear };


// === js/settings.js ===
// Settings store. baseURL + model in localStorage; apiKey in localStorage too
// (browsers don't have native Keychain; localStorage is acceptable for a PWA).

const KEY_BASEURL = 'ledgerly.baseURL';
const KEY_APIKEY = 'ledgerly.apiKey';
const KEY_MODEL = 'ledgerly.model';

const Settings = {
  get baseURL() { return localStorage.getItem(KEY_BASEURL) || 'https://api.openai.com/v1'; },
  set baseURL(v) { localStorage.setItem(KEY_BASEURL, v); },

  get apiKey() { return localStorage.getItem(KEY_APIKEY) || ''; },
  set apiKey(v) { localStorage.setItem(KEY_APIKEY, v); },

  get model() { return localStorage.getItem(KEY_MODEL) || 'gpt-4o-mini'; },
  set model(v) { localStorage.setItem(KEY_MODEL, v); },

  get config() {
    return { baseURL: this.baseURL, apiKey: this.apiKey, model: this.model };
  },

  get isConfigured() {
    return !!this.apiKey.trim() && !!this.baseURL.trim() && !!this.model.trim();
  }
};

window.Settings = Settings;


// === js/llm.js ===
// OpenAI-compatible LLM client. Same logic as iOS LLMService.

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

async function extractExpenseFromText(text) {
  const messages = [
    { role: 'system', content: commonSystemPrompt() },
    { role: 'user', content: text }
  ];
  const raw = await request({ messages });
  return parse(raw);
}

async function extractExpenseFromImage(base64) {
  const raw = await request({ imageBase64: base64 });
  return parse(raw);
}

async function testConnection() {
  const messages = [
    { role: 'system', content: commonSystemPrompt() },
    { role: 'user', content: '测试：今天买咖啡 30 元' }
  ];
  const raw = await request({ messages });
  return parse(raw);
}

window.LLM = { extractExpenseFromText, extractExpenseFromImage, testConnection };


// === js/speech.js ===
// Web Speech API wrapper. Returns a controller object so they can reliably
// start/stop recognition (previous implementation wedged on iOS Safari because
// recognition only ended on its own with continuous=false).

const LANG = 'zh-CN';

function getRecognizerCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

function isSupported() {
  return !!getRecognizerCtor();
}

/**
 * Create a recognition session. Usage:
 *   const ctl = createRecognizer({ onInterim, onFinal, onError });
 *   ctl.start();
 *   // later:
 *   ctl.stop();   // stops & resolves with the final transcript (or empty)
 *   ctl.cancel(); // stops & discards (no resolve)
 */
function createRecognizer({ onInterim, onFinal, onError, onEnd } = {}) {
  const SR = getRecognizerCtor();
  if (!SR) throw new Error('当前浏览器不支持语音识别');

  let rec = null;
  let stopped = false;
  let lastFinal = '';
  let lastInterim = '';

  function handleResult(e) {
    let final = '';
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (final) lastFinal += final;
    if (interim) lastInterim = interim;
    if (onInterim && (final || interim)) {
      onInterim((lastFinal + interim).trim());
    }
    if (final && onFinal) onFinal(final);
  }

  function build() {
    rec = new SR();
    rec.lang = LANG;
    rec.continuous = true;        // 关键：让我们能 stop 任意时刻
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = handleResult;
    rec.onerror = (e) => {
      // 'no-speech' / 'aborted' 不算真正的错误
      if (e.error === 'aborted' || e.error === 'no-speech') return;
      if (onError) onError(e);
    };
    rec.onend = () => {
      // onend 会因为 stop() 或网络中断触发。处理结果由 stop() / cancel() 决定。
      if (onEnd) onEnd({ final: lastFinal.trim(), interim: lastInterim.trim() });
    };
  }

  return {
    start() {
      if (rec) return; // 已运行
      lastFinal = '';
      lastInterim = '';
      stopped = false;
      build();
      try {
        rec.start();
      } catch (err) {
        // 'invalid-state' 表示已经在跑
        if (err.error && err.error.name === 'InvalidStateError') return;
        if (onError) onError(err);
      }
    },
    /** 停止并产出最终文本（不会 resolve Promise，仅触发 onEnd） */
    stop() {
      if (!rec) return;
      stopped = true;
      try { rec.stop(); } catch {}
      rec = null;
    },
    /** 立刻中止，丢弃所有结果 */
    cancel() {
      if (!rec) return;
      stopped = true;
      try { rec.abort(); } catch {}
      rec = null;
    },
    isRunning() { return !!rec; }
  };
}

// 兼容旧 API（保留以防其他 view 还在用）
function listen({ onInterim } = {}) {
  return new Promise((resolve, reject) => {
    const ctl = createRecognizer({
      onInterim,
      onEnd: ({ final }) => {
        if (final) resolve(final);
        else reject(new Error('未识别到语音'));
      }
    });
    ctl.start();
  });
}

function stop() {
  // 旧 API 停止方法（兼容层）
  // 旧版本用 listen._current，新版用 controller.stop()
  // 由于没人再调用旧 stop，这里保留空实现
}
window.Speech = { isSupported, createRecognizer, listen, stop };


// === js/util.js ===
// Shared helpers used by views.

function fmtMoney(d) {
  const n = Number(d);
  if (!isFinite(n)) return '0';
  const parts = n.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

function fmtDate(d, withTime = true) {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  const h = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return withTime ? `${y}-${m}-${day} ${h}:${mi}` : `${y}-${m}-${day}`;
}

function fmtMonthDay(d) {
  const dt = new Date(d);
  return `${dt.getMonth() + 1}-${String(dt.getDate()).padStart(2, '0')}`;
}

function fmtYM(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

const CAT_ICONS = {
  '餐饮': '🍴', '交通': '🚗', '购物': '🛍', '娱乐': '🎮',
  '住房': '🏠', '医疗': '➕', '教育': '🎓', '其他': '·'
};

function catIcon(c) {
  return CAT_ICONS[c] || '·';
}

function startOfDay(d) {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function startOfWeek(d) {
  const dt = startOfDay(d);
  const day = dt.getDay(); // 0..6 (Sun..Sat)
  const delta = (day + 6) % 7; // Monday-based start
  dt.setDate(dt.getDate() - delta);
  return dt;
}

function startOfMonth(d) {
  const dt = startOfDay(d);
  dt.setDate(1);
  return dt;
}

function startOfYear(d) {
  const dt = startOfDay(d);
  dt.setMonth(0, 1);
  return dt;
}

function isoNow() {
  return new Date().toISOString();
}

function showToast(msg, ms = 2400) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, ms);
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

/**
 * 把对象数组导出为 CSV（含 BOM，Excel 直接打开不乱码）。
 * columns: [{ key: 'name', label: '姓名' }, ...]
 */
function exportCSV(records, columns, filename) {
  if (!records.length) {
    showToast('没有数据可导出');
    return;
  }
  const esc = v => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const header = columns.map(c => esc(c.label)).join(',');
  const rows = records.map(r => columns.map(c => esc(c.format ? c.format(r[c.key]) : r[c.key])).join(','));
  // ﻿ BOM 让 Excel 识别 UTF-8
  const csv = '﻿' + header + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'export.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('已导出 ' + records.length + ' 条');
}

/**
 * 解析 CSV 文本为对象数组。自动处理：
 * - UTF-8 BOM
 * - 双引号包裹 + 双引号转义（"" → "）
 * - 含逗号 / 换行的字段
 * - 空行
 */
function parseCSV(text) {
  if (!text) return { headers: [], rows: [] };
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const rows = [];
  let cur = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        cur.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        cur.push(field); field = '';
        if (cur.length > 1 || (cur.length === 1 && cur[0])) rows.push(cur);
        cur = [];
        if (c === '\r' && text[i + 1] === '\n') i++;
      } else {
        field += c;
      }
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }

  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0];
  const data = rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = r[idx] || ''; });
    return obj;
  });
  return { headers, rows: data };
}

/**
 * 解析各种格式的金额字符串：
 * - "128" / "128.0" / "128.00"
 * - "1,280" / "1,280.00"（带千分位逗号）
 * - "¥128" / "$128" / "￥128.00"
 * - "128 元"
 * 返回数字；解析失败返回 0。
 */
function parseAmount(s) {
  if (s == null) return 0;
  let t = String(s).trim();
  if (!t) return 0;
  // 去掉货币符号 / 单位
  t = t.replace(/[¥￥$€£￥]/g, '').replace(/元|块|RMB/gi, '').trim();
  // 去千分位逗号
  t = t.replace(/,/g, '');
  // 去尾部单点后缀（如 "128.0" → 128）
  if (/^\d+\.\d*0+$/.test(t)) t = t.replace(/\.?0+$/, '');
  // 留首个合法数字串
  const m = t.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

/**
 * 解析日期字符串，兼容多种格式：
 * - ISO 8601: 2026-10-12T14:30:00.000Z / 2026-10-12 14:30:00
 * - 中文: 2026/10/12 14:30 / 2026年10月12日 14:30
 * - 美式: 10/12/2026 2:30 PM
 * 失败返回 null。
 */
function parseDate(s) {
  if (!s) return null;
  let t = String(s).trim();
  if (!t) return null;
  // 直接试 Date 构造
  let parsed = new Date(t);
  if (!isNaN(parsed.getTime())) return parsed;
  // 替换中文 / 美式
  t = t.replace(/年|月/g, '/').replace(/日/g, ' ');
  // 10/12/2026 2:30 PM → 2026-10-12 14:30
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (m) {
    let [, mm, dd, yyyy, hh, mi, ss, ap] = m;
    let H = parseInt(hh, 10);
    if (ap) {
        const isPM = ap.toUpperCase() === 'PM';
        if (isPM && H < 12) H += 12;
        if (!isPM && H === 12) H = 0;
      }
    const yr = yyyy.length === 2 ? 2000 + parseInt(yyyy, 10) : parseInt(yyyy, 10);
    return new Date(yr, parseInt(mm, 10) - 1, parseInt(dd, 10), H, parseInt(mi, 10), ss ? parseInt(ss, 10) : 0);
  }
  return null;
}

window.Util = { fmtMoney, fmtDate, fmtMonthDay, fmtYM, catIcon, startOfDay, startOfWeek, startOfMonth, startOfYear, isoNow, showToast, el, exportCSV, parseCSV, parseAmount, parseDate };


// === js/views/input.js ===
(function() {
const DB = window.DB;
const Settings = window.Settings;
const { extractExpenseFromText, extractExpenseFromImage } = window.LLM;
const { isSupported: speechSupported, createRecognizer } = window.Speech;
const { el, fmtDate, fmtMoney, showToast } = window.Util;





const EXAMPLES = [
  '今天中午和同事吃火锅花了 128 元',
  '昨天打车到机场 60 元',
  '上周五超市采购日用品 235 元',
  '今晚和朋友看演唱会 380 元'
];

let lastSaved = null;
let lastError = null;
let isSubmitting = false;

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function saveExtracted(extracted, raw) {
  if (!(extracted.amount > 0)) throw new Error('未能识别到消费信息（金额为 0），未写入记录。');
  const cat = (extracted.category || '').trim();
  if (!cat) throw new Error('未能识别到消费信息（类别为空），未写入记录。');
  const desc = (extracted.description || '').trim() || cat;
  const ts = parseDate(extracted.timestamp) || new Date();

  const record = {
    id: crypto.randomUUID(),
    timestamp: ts.toISOString(),
    category: cat,
    amount: Number(extracted.amount),
    description: desc,
    rawInput: raw,
    createdAt: new Date().toISOString()
  };
  await DB.add(record);
  return record;
}

async function submitText(text) {
  if (!Settings.isConfigured) throw new Error('请先在「设置」中填写 Base URL / API Key / Model');
  const extracted = await LLM.extractExpenseFromText(text);
  return await saveExtracted(extracted, text);
}

async function submitImage(file) {
  if (!Settings.isConfigured) throw new Error('请先在「设置」中填写 Base URL / API Key / Model');
  const base64 = await fileToBase64(file);
  const extracted = await LLM.extractExpenseFromImage(base64);
  return await saveExtracted(extracted, '[图片]');
}

// 删除一条记录（首页"已记录"卡片用）
async function deleteRecord(r) {
  await DB.remove(r.id);
  if (lastSaved && lastSaved.id === r.id) {
    lastSaved = null;
  }
}

// ========== 语音 sheet（重写版） ==========
function showVoiceSheet({ onSubmit, onCancel }) {
  if (!speechSupported()) {
    showToast('当前浏览器不支持语音识别');
    return;
  }

  const overlay = el('div', { class: 'sheet-overlay' });
  const sheet = el('div', { class: 'sheet' });
  const title = el('h3', {}, '语音记账');

  const circle = el('div', { class: 'voice-circle' }, '🎙');
  const time = el('div', { class: 'voice-time' }, '00:00');
  const transcriptBox = el('div', {
    class: 'voice-transcript',
    style: 'min-height:48px; max-height:120px; overflow:auto; padding:10px; border-radius:8px; background:#f5f5f7; font-size:14px; margin:8px 0 16px; color:#333; white-space:pre-wrap;'
  }, '点击麦克风开始说话');
  const hint = el('div', { class: 'muted', style: 'font-size:11px; margin-bottom:8px;' }, '提示：可中途点 ✓ 完成，会自动把文字填到文本框');

  const btnRow = el('div', { class: 'voice-buttons' });
  const cancelBtn = el('button', { class: 'voice-btn cancel' }, '✕');
  const toggleBtn = el('button', { class: 'voice-btn', id: 'voice-toggle' }, '🎙');
  const confirmBtn = el('button', { class: 'voice-btn', id: 'voice-confirm' }, '✓');
  btnRow.append(cancelBtn, toggleBtn, confirmBtn);

  sheet.append(title, circle, hint, transcriptBox, time, btnRow);
  overlay.append(sheet);
  document.body.append(overlay);

  let startedAt = 0;
  let timer = null;
  let lastTranscript = '';
  const ctl = createRecognizer({
    onInterim: (text) => {
      lastTranscript = text;
      transcriptBox.textContent = text || '点击麦克风开始说话';
    },
    onError: (e) => {
      showToast('语音识别错误：' + (e.error || e.message || 'unknown'));
    },
    onEnd: ({ final }) => {
      // 只要拿到 final 就视为成功，可点 ✓ 提交
      if (final) lastTranscript = final;
      transcriptBox.textContent = lastTranscript || '（未识别到）';
    }
  });

  function tick() {
    const sec = Math.floor((Date.now() - startedAt) / 1000);
    time.textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  }

  function start() {
    if (ctl.isRunning()) return;
    ctl.start();
    startedAt = Date.now();
    circle.classList.add('recording');
    transcriptBox.textContent = '正在听...';
    timer = setInterval(tick, 200);
  }

  function stop() {
    if (!ctl.isRunning()) return;
    ctl.stop();
    circle.classList.remove('recording');
    if (timer) { clearInterval(timer); timer = null; }
  }

  function cleanup() {
    if (ctl.isRunning()) ctl.cancel();
    if (timer) clearInterval(timer);
    overlay.remove();
  }

  toggleBtn.onclick = () => {
    if (ctl.isRunning()) stop();
    else start();
  };

  confirmBtn.onclick = () => {
    // 拿到当前累积文本，关闭弹窗，提交到文本框
    stop();
    cleanup();
    onSubmit(lastTranscript || '');
  };

  cancelBtn.onclick = () => {
    cleanup();
    onCancel();
  };
}

// ========== 图片选择处理 ==========
async function handleImageFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) {
    showToast('请选择图片文件');
    return;
  }
  try {
    setBusy(true);
    const record = await submitImage(file);
    lastSaved = record;
    lastError = null;
    showToast('已保存');
    renderInput();
  } catch (e) {
    lastError = e.message;
    lastSaved = null;
    renderInput();
  } finally {
    setBusy(false);
  }
}

function setBusy(v) {
  isSubmitting = v;
  const btn = document.getElementById('submit-btn');
  if (btn) {
    btn.disabled = v;
    btn.textContent = v ? '正在解析...' : '保存记录';
  }
}

// ========== 渲染入口 ==========
function renderInput() {
  const root = document.getElementById('view');
  root.innerHTML = '';

  const wrap = el('div', { style: 'padding: 16px;' });

  // 已记录卡片（含删除按钮）
  if (lastSaved) {
    wrap.appendChild(el('div', { class: 'saved-card' },
      el('div', { class: 'icon' }, '✅'),
      el('div', { class: 'body' },
        el('h3', {}, `${lastSaved.category} · ¥${fmtMoney(lastSaved.amount)}`),
        el('div', { class: 'desc' }, lastSaved.description),
        el('div', { class: 'time' }, fmtDate(lastSaved.timestamp))
      ),
      el('button', {
        class: 'delete-btn',
        title: '删除这条记录',
        onclick: async () => {
          if (!confirm('确定删除这条记录？')) return;
          try {
            await deleteRecord(lastSaved);
            showToast('已删除');
            renderInput();
          } catch (e) {
            showToast('删除失败：' + e.message);
          }
        }
      }, '🗑')
    ));
  }

  // 输入区
  wrap.appendChild(el('h2', {}, '自然语言输入'));
  wrap.appendChild(el('div', { class: 'muted', style: 'margin-bottom: 6px;' }, '直接说一句话，或用下方「语音 / 相机 / 相册」按钮提交凭证'));
  const ta = el('textarea', { id: 'text-input', class: 'text-area', placeholder: '在这里输入...' });
  wrap.appendChild(ta);

  // 示例
  const expWrap = el('div', { style: 'margin-top: 12px;' });
  expWrap.appendChild(el('div', { class: 'muted', style: 'margin-bottom: 4px;' }, '试试这些'));
  const expRow = el('div', { class: 'examples' });
  for (const e of EXAMPLES) {
    expRow.appendChild(el('button', {
      class: 'chip',
      onclick: () => { ta.value = e; ta.focus(); }
    }, e));
  }
  expWrap.appendChild(expRow);
  wrap.appendChild(expWrap);

  // 快捷按钮
  wrap.appendChild(el('h2', { style: 'margin-top: 16px;' }, '快速记录'));
  const actionsRow = el('div', { class: 'actions-row' });
  const cameraInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
  const galleryInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  cameraInput.onchange = () => { if (cameraInput.files[0]) handleImageFile(cameraInput.files[0]); };
  galleryInput.onchange = () => { if (galleryInput.files[0]) handleImageFile(galleryInput.files[0]); };

  actionsRow.appendChild(el('button', {
    class: 'btn-action pink',
    onclick: () => showVoiceSheet({
      onSubmit: (text) => {
        if (text) {
          ta.value = text;
          showToast('已识别：' + text);
        } else {
          showToast('未识别到语音');
        }
      },
      onCancel: () => {}
    })
  }, el('div', { class: 'ico' }, '🎙'), el('div', {}, '语音')));
  actionsRow.appendChild(el('button', {
    class: 'btn-action blue',
    onclick: () => cameraInput.click()
  }, el('div', { class: 'ico' }, '📷'), el('div', {}, '相机')));
  actionsRow.appendChild(el('button', {
    class: 'btn-action green',
    onclick: () => galleryInput.click()
  }, el('div', { class: 'ico' }, '🖼'), el('div', {}, '相册')));
  wrap.appendChild(actionsRow);
  wrap.appendChild(cameraInput);
  wrap.appendChild(galleryInput);

  // 错误提示
  if (lastError) {
    wrap.appendChild(el('div', { class: 'error', style: 'margin-top: 10px;' }, lastError));
  }

  // 保存按钮
  const submitBtn = el('button', {
    id: 'submit-btn',
    class: 'btn-primary',
    onclick: onSubmitText
  }, '保存记录');
  wrap.appendChild(submitBtn);

  root.appendChild(wrap);

  async function onSubmitText() {
    const text = (ta.value || '').trim();
    if (!text) return;
    try {
      setBusy(true);
      const rec = await submitText(text);
      lastSaved = rec;
      lastError = null;
      ta.value = '';
      renderInput();
    } catch (e) {
      lastError = e.message || String(e);
      renderInput();
    } finally {
      setBusy(false);
    }
  }
}
window.renderInput = renderInput;

})();

// === js/views/stats.js ===
(function() {
const DB = window.DB;
const { el, fmtMoney, fmtYM, fmtMonthDay, showToast, startOfWeek, startOfMonth, startOfYear, startOfDay } = window.Util;


let allRecords = [];
let topLevel = 'month'; // 'week' | 'month' | 'year'
let selectedBucketKey = null;

async function loadRecords() {
  allRecords = await DB.getAll();
}

function periodStart(now) {
  if (topLevel === 'week') return startOfWeek(now);
  if (topLevel === 'month') return startOfMonth(now);
  return startOfYear(now);
}

function periodEnd(now) {
  // end of today (inclusive)
  const e = new Date(now);
  e.setHours(23, 59, 59, 999);
  return e;
}

function bucketize() {
  const now = new Date();
  const start = periodStart(now);
  const end = periodEnd(now);
  const comp = topLevel === 'week' ? 'week' : (topLevel === 'month' ? 'month' : 'year');

  const buckets = new Map();
  for (const r of allRecords) {
    const ts = new Date(r.timestamp);
    if (ts < start || ts > end) continue;
    let key;
    if (comp === 'week') {
      key = startOfWeek(ts).toISOString();
    } else if (comp === 'month') {
      key = `${ts.getFullYear()}-${ts.getMonth()}`;
    } else {
      key = `${ts.getFullYear()}`;
    }
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }

  const list = [...buckets.entries()].map(([key, items]) => {
    items.sort((a, b) => Number(b.amount) - Number(a.amount));
    const total = items.reduce((s, x) => s + Number(x.amount), 0);
    const days = daysInBucket(key, comp);
    const avg = days > 0 ? total / days : 0;
    return { key, items, total, days, avg };
  });
  list.sort((a, b) => b.key.localeCompare(a.key));
  return list;
}

function daysInBucket(key, comp) {
  if (comp === 'week') return 7;
  if (comp === 'month') {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m + 1, 0).getDate();
  }
  const y = Number(key);
  return ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 366 : 365;
}

function bucketLabel(key, comp) {
  if (comp === 'week') {
    const start = new Date(key);
    const m = start.getMonth() + 1;
    const d = start.getDate();
    const w = getWeekNumber(start);
    return `${start.getFullYear()} 第${w}周 (${m}-${d})`;
  }
  if (comp === 'month') {
    const [y, m] = key.split('-').map(Number);
    return `${y}年${String(m).padStart(2, '0')}月`;
  }
  return `${key}年`;
}

function getWeekNumber(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const yearStart = new Date(date.getFullYear(), 0, 1);
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function getCurrentBucket() {
  const list = bucketize();
  if (!list.length) return null;
  if (selectedBucketKey) {
    const found = list.find(b => b.key === selectedBucketKey);
    if (found) return found;
  }
  return list[0];
}

function dayPoints(bucket) {
  // aggregate to days; fill missing days with 0
  const cal = now => 1;
  const comp = topLevel === 'week' ? 'day' : (topLevel === 'month' ? 'day' : 'month');
  const aligned = bucket.items.map(r => {
    const ts = new Date(r.timestamp);
    const d = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate());
    return [d.toISOString().slice(0, 10), Number(r.amount)];
  });
  const sums = {};
  for (const [k, v] of aligned) sums[k] = (sums[k] || 0) + v;

  // determine range
  let rangeStart, rangeEnd;
  if (topLevel === 'week') {
    const s = new Date(bucket.key);
    rangeStart = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    rangeEnd = new Date(rangeStart);
    rangeEnd.setDate(rangeEnd.getDate() + 6);
  } else if (topLevel === 'month') {
    const [y, m] = bucket.key.split('-').map(Number);
    rangeStart = new Date(y, m, 1);
    rangeEnd = new Date(y, m + 1, 0);
  } else {
    const y = Number(bucket.key);
    rangeStart = new Date(y, 0, 1);
    rangeEnd = new Date(y, 11, 31);
  }

  const out = [];
  for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
    const k = d.toISOString().slice(0, 10);
    out.push({ date: new Date(d), total: sums[k] || 0 });
  }
  return out;
}

function monthPoints(bucket) {
  const sums = {};
  for (const r of bucket.items) {
    const ts = new Date(r.timestamp);
    const k = `${ts.getFullYear()}-${ts.getMonth()}`;
    sums[k] = (sums[k] || 0) + Number(r.amount);
  }
  const y = Number(bucket.key);
  const out = [];
  for (let m = 0; m < 12; m++) {
    const k = `${y}-${m}`;
    out.push({ date: new Date(y, m, 1), total: sums[k] || 0 });
  }
  return out;
}

function drawChart(canvas, points, labelFmt, isYear) {
  if (!points.length) return;

  // Chart.js 没加载成功时（CDN 慢/被墙/CDN 故障），回退到 Canvas 自绘
  if (!window.Chart || window.__chartLoadFailed) {
    console.warn('Chart.js 未加载，回退到 Canvas 自绘');
    drawChartFallback(canvas, points, labelFmt, isYear);
    return;
  }

  try {
  // 用 category scale（不用 time scale，避免依赖 chartjs-adapter）
  const data = points.map(p => ({
    x: labelFmt(p.date),
    y: p.total
  }));

  // 销毁旧实例（避免内存泄漏 + 多次切换 bucket 后累积）
  if (canvas._chartInstance) {
    canvas._chartInstance.destroy();
    canvas._chartInstance = null;
  }

  canvas._chartInstance = new window.Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: points.map(p => labelFmt(p.date)),
      datasets: [{
        label: '消费金额',
        data: data,
        borderColor: '#3c5066',
        backgroundColor: 'rgba(60, 80, 102, 0.08)',
        borderWidth: 2.5,
        tension: 0.3,
        pointRadius: ctx => ctx.raw && ctx.raw.y > 0 ? 4 : 0,
        pointHoverRadius: 6,
        pointBackgroundColor: '#3c5066',
        pointBorderColor: '#fff',
        pointBorderWidth: 1.5,
        fill: true,
        spanGaps: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 350 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(0,0,0,0.85)',
          titleFont: { size: 12 },
          bodyFont: { size: 13, weight: '600' },
          padding: 8,
          displayColors: false,
          callbacks: {
            label: (item) => '¥' + fmtMoney(item.parsed.y)
          }
        }
      },
      scales: {
        x: {
          type: 'category',
          grid: { display: false },
          ticks: {
            color: '#666',
            font: { size: 11 },
            maxRotation: 0,
            autoSkipPadding: 18,
            autoSkip: true
          }
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,0.06)' },
          ticks: {
            color: '#666',
            font: { size: 11 },
            callback: (v) => '¥' + v
          }
        }
      }
    }
  });
  } catch (err) {
    console.error('Chart.js 初始化失败:', err);
    if (window.showError) window.showError('Chart 初始化失败', err.stack || err.message);
    drawChartFallback(canvas, points, labelFmt, isYear);
  }
}

// 简易 Canvas 折线图（Chart.js 失败时的回退）
function drawChartFallback(canvas, points, labelFmt, isYear) {
  if (canvas._chartInstance) { canvas._chartInstance = null; }
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  if (!points.length) return;

  const padL = 36, padR = 12, padT = 12, padB = 24;
  const W0 = W - padL - padR, H0 = H - padT - padB;
  const maxV = Math.max(...points.map(p => p.total), 1);
  const xStep = points.length > 1 ? W0 / (points.length - 1) : 0;
  const yFor = v => padT + H0 - (v / maxV) * H0;

  // grid + y labels
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.fillStyle = '#888';
  ctx.font = '10px -apple-system';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = padT + (H0 * i / 4);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + W0, y);
    ctx.stroke();
    ctx.fillText('¥' + Math.round(maxV * (1 - i / 4)), padL - 4, y + 3);
  }

  // line
  ctx.strokeStyle = '#3c5066';
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = padL + i * xStep, y = yFor(p.total);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // points (>0)
  ctx.fillStyle = '#3c5066';
  points.forEach((p, i) => {
    if (p.total <= 0) return;
    const x = padL + i * xStep, y = yFor(p.total);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // x labels
  ctx.fillStyle = '#666';
  ctx.textAlign = 'center';
  const labelCount = Math.min(6, points.length);
  for (let i = 0; i < labelCount; i++) {
    const idx = Math.round((points.length - 1) * (i / Math.max(1, labelCount - 1)));
    const x = padL + idx * xStep;
    ctx.fillText(labelFmt(points[idx].date), x, padT + H0 + 12);
  }
}

function renderStatCard(label, value, klass) {
  return el('div', { class: 'stat ' + klass },
    el('div', { class: 'label' }, label),
    el('div', { class: 'value' }, value)
  );
}

// 分类消费饼图（环形）
function renderCategoryPieCard(items) {
  const card = el('div', { class: 'card chart-card' });
  const header = el('div', { style: 'display:flex; justify-content: space-between; align-items: center; margin-bottom: 8px;' });
  header.append(
    el('div', {}, '分类消费统计'),
    el('span', { class: 'chart-tag' }, '饼图')
  );
  card.appendChild(header);

  // 聚合分类
  const sums = {};
  items.forEach(r => { sums[r.category] = (sums[r.category] || 0) + Number(r.amount); });
  const entries = Object.entries(sums).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    card.appendChild(el('div', { class: 'muted', style: 'padding: 24px 0; text-align: center;' }, '该周期无数据'));
    return card;
  }

  const total = entries.reduce((s, e) => s + e[1], 0);
  const palette = ['#3c5066', '#f08c00', '#2f9e44', '#d6336c', '#4c6ef5', '#868e96', '#fab005', '#7950f2'];
  const canvas = el('canvas', { style: 'width: 100%; height: 220px;' });
  card.appendChild(canvas);

  // 列表（饼图下方显示具体数字 + 百分比）
  const list = el('div', { style: 'margin-top: 12px;' });
  entries.forEach((e, idx) => {
    const pct = total > 0 ? (e[1] / total * 100).toFixed(1) : '0';
    list.appendChild(el('div', { style: 'display:flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px;' },
      el('div', { style: `width: 12px; height: 12px; border-radius: 2px; background: ${palette[idx % palette.length]};` }),
      el('div', { style: 'flex: 1;' }, e[0]),
      el('div', { style: 'color: #666; font-size: 12px;' }, pct + '%'),
      el('div', { style: 'font-weight: 600; font-variant-numeric: tabular-nums;' }, '¥' + fmtMoney(e[1]))
    ));
  });
  card.appendChild(list);

  // 等 DOM 挂上后再绘制
  setTimeout(() => {
    if (!window.Chart || window.__chartLoadFailed) return;
    if (canvas._pieInstance) canvas._pieInstance.destroy();
    canvas._pieInstance = new window.Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: entries.map(e => e[0]),
        datasets: [{
          data: entries.map(e => e[1]),
          backgroundColor: palette.slice(0, entries.length),
          borderColor: '#fff',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(0,0,0,0.85)',
            titleFont: { size: 12 },
            bodyFont: { size: 13, weight: '600' },
            padding: 8,
            callbacks: {
              label: (item) => {
                const t = item.dataset.data.reduce((a, b) => a + b, 0);
                const pct = t > 0 ? (item.parsed / t * 100).toFixed(1) : 0;
                return item.label + ': ¥' + fmtMoney(item.parsed) + ' (' + pct + '%)';
              }
            }
          }
        }
      }
    });
  }, 0);

  return card;
}

async function renderStats() {
  await loadRecords();
  const root = document.getElementById('view');
  root.innerHTML = '';

  const wrap = el('div', { style: 'padding-top: 8px;' });

  // period picker
  const picker = el('div', { class: 'period-picker' });
  ['week', 'month', 'year'].forEach(k => {
    const btn = el('button', { class: k === topLevel ? 'active' : '', onclick: () => { topLevel = k; selectedBucketKey = null; renderStats(); } }, k === 'week' ? '本周' : (k === 'month' ? '本月' : '本年'));
    picker.appendChild(btn);
  });
  wrap.appendChild(picker);

  const buckets = bucketize();
  if (!buckets.length) {
    wrap.appendChild(el('div', { class: 'empty' },
      el('div', { class: 'ico' }, '📈'),
      el('div', {}, '暂无记录，去「记一笔」添加消费吧')
    ));
    root.appendChild(wrap);
    return;
  }

  // bucket picker
  const bucketRow = el('div', { class: 'bucket-picker' });
  for (const b of buckets) {
    const isActive = b.key === (selectedBucketKey || buckets[0].key);
    const btn = el('button', { class: isActive ? 'active' : '', onclick: () => { selectedBucketKey = b.key; renderStats(); } }, bucketLabel(b.key, topLevel));
    bucketRow.appendChild(btn);
  }
  wrap.appendChild(bucketRow);

  const cur = getCurrentBucket();
  if (!cur) { root.appendChild(wrap); return; }

  // summary
  const sum = el('div', { class: 'summary-row' });
  sum.append(
    renderStatCard('统计总额', '¥' + fmtMoney(cur.total), 'accent'),
    renderStatCard('消费笔数', String(cur.items.length), 'green'),
    renderStatCard('日均', '¥' + fmtMoney(cur.avg), 'orange')
  );
  wrap.appendChild(sum);

  // chart
  const chartCard = el('div', { class: 'card chart-card' });
  const headerRow = el('div', { style: 'display:flex; justify-content: space-between; align-items: center; margin-bottom: 6px;' });
  headerRow.append(
    el('div', {}, bucketLabel(cur.key, topLevel)),
    el('span', { class: 'chart-tag' }, topLevel === 'year' ? '按月' : '按日')
  );
  chartCard.appendChild(headerRow);
  const canvas = el('canvas', { style: 'width: 100%; height: 220px;' });
  chartCard.appendChild(canvas);
  wrap.appendChild(chartCard);

  // 分类饼图
  const pieCard = renderCategoryPieCard(cur.items);
  wrap.appendChild(pieCard);

  // top 10
  const topCard = el('div', { class: 'card' });
  const topHeader = el('div', { style: 'display:flex; justify-content: space-between; margin-bottom: 8px;' });
  topHeader.append(el('h2', { style: 'margin:0;' }, '支出排行'), el('span', { class: 'muted' }, 'Top 10'));
  topCard.appendChild(topHeader);
  const top10 = cur.items.slice(0, 10);
  top10.forEach((r, idx) => {
    const rank = idx + 1;
    const klass = rank <= 3 ? `rank-${rank}` : 'rank-default';
    const row = el('div', { class: 'top-item' },
      el('div', { class: 'rank-circle ' + klass }, String(rank)),
      el('div', { class: 'top-info' },
        el('div', { class: 'name' }, r.description),
        el('div', { class: 'meta' }, `${r.category} · ${fmtYM(r.timestamp).slice(5)}-${String(new Date(r.timestamp).getDate()).padStart(2,'0')} ${String(new Date(r.timestamp).getHours()).padStart(2,'0')}:${String(new Date(r.timestamp).getMinutes()).padStart(2,'0')}`)
      ),
      el('div', { class: 'top-amount' }, '¥' + fmtMoney(r.amount)),
      el('button', {
        class: 'delete-row-btn',
        title: '删除这条记录',
        onclick: async (e) => {
          e.stopPropagation();
          if (!confirm('确定删除「' + r.description + '」？')) return;
          try {
            await DB.remove(r.id);
            showToast('已删除');
            await renderStats();
          } catch (err) {
            showToast('删除失败：' + err.message);
          }
        }
      }, '🗑')
    );
    topCard.appendChild(row);
  });
  wrap.appendChild(topCard);

  root.appendChild(wrap);

  // Render chart after DOM attached
  setTimeout(() => {
    const isYear = topLevel === 'year';
    const points = isYear ? monthPoints(cur) : dayPoints(cur);
    const fmt = isYear ? (d => `${d.getMonth() + 1}月`) : (d => `${d.getMonth() + 1}/${d.getDate()}`);
    drawChart(canvas, points, fmt, isYear);
  }, 0);
}

window.renderStats = renderStats;

})();

// === js/views/records.js ===
(function() {
const DB = window.DB;
const { el, fmtMoney, fmtDate, fmtYM, fmtMonthDay, catIcon, startOfDay, showToast, exportCSV } = window.Util;


let allRecords = [];
let search = '';
let useDateRange = false;
let rangeStart = '';
let rangeEnd = '';
// 不再支持按日/按月切换，默认按月显示，每月内按日归拢
const groupMode = 'month';

async function load() {
  allRecords = (await DB.getAll()).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function matchesQuery(r) {
  if (!search) return true;
  const s = search.toLowerCase();
  return (r.description || '').toLowerCase().includes(s)
    || (r.category || '').toLowerCase().includes(s)
    || (r.rawInput || '').toLowerCase().includes(s);
}

function inRange(r) {
  if (!useDateRange) return true;
  const t = new Date(r.timestamp);
  const s = startOfDay(new Date(rangeStart));
  const e = new Date(rangeEnd);
  e.setHours(23, 59, 59, 999);
  return t >= s && t <= e;
}

function filtered() {
  return allRecords.filter(r => matchesQuery(r) && inRange(r));
}

function groupByDay(records) {
  const groups = new Map();
  for (const r of records) {
    const d = startOfDay(new Date(r.timestamp)).toISOString();
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(r);
  }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function groupByMonth(records) {
  const groups = new Map();
  for (const r of records) {
    const m = fmtYM(r.timestamp);  // 'YYYY-MM'
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push(r);
  }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function formatDayHeader(iso) {
  return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatMonthHeader(ym) {
  const [y, m] = ym.split('-');
  return `${y}年${m}月`;
}

// 可折叠分组标题。collapsedMap 记录哪些 key 是折叠的（key 形如 'day:2026-09-26' 或 'month:2026-09'）
const collapsedMap = new Set();

// 判断一个 key 是不是"当月"（用于默认折叠逻辑）
function isCurrentPeriodKey(key) {
  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const curDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  // month:YYYY-MM
  if (key.startsWith('month:')) return key === 'month:' + curYM;
  // day:YYYY-MM-DD
  if (key.startsWith('day:')) return key === 'day:' + curDay;
  return false;
}

// 折叠状态管理：当月展开，其他月折叠
// kind: 'month' | 'day' — day 强制展开（不参与折叠逻辑）
function isCollapsed(key, kind) {
  if (kind === 'day') return false;  // 按天组始终展开
  if (collapsedMap.has(key)) return true;  // 用户手动折叠的，记忆
  if (collapsedMap.has('__expanded:' + key)) return false;  // 用户手动展开的，记忆
  // 首次访问：非当月默认折叠
  return !isCurrentPeriodKey(key);
}
function toggle(key) {
  if (collapsedMap.has(key)) {
    collapsedMap.delete(key);
    collapsedMap.add('__expanded:' + key);
  } else if (collapsedMap.has('__expanded:' + key)) {
    collapsedMap.delete('__expanded:' + key);
    collapsedMap.add(key);
  } else {
    // 首次切换：根据目标状态决定
    if (isCurrentPeriodKey(key)) {
      // 当月展开 → 现在折叠
      collapsedMap.add(key);
    } else {
      // 非当月折叠 → 现在展开
      collapsedMap.add('__expanded:' + key);
    }
  }
}

function makeGroupHeader({ key, label, summary, onToggle, kind }) {
  const collapsed = isCollapsed(key, kind);
  const handleToggle = () => {
    toggle(key);
    if (onToggle) onToggle();
  };
  const isCollapsible = kind !== 'day';  // 按天组不折叠
  const header = el('div', { class: 'day-section collapsible' });
  const left = el('span', { style: 'display:flex; align-items:center; gap:6px; flex:1;' },
    isCollapsible
      ? el('span', {
          class: 'caret',
          style: 'font-size:10px; transition: transform 0.15s; display:inline-block; width:10px;',
          onclick: (e) => { e.stopPropagation(); handleToggle(); }
        }, collapsed ? '▶' : '▼')
      : el('span', { style: 'display:inline-block; width:10px;' }),  // 占位
    el('span', {}, label)
  );
  header.appendChild(left);
  header.appendChild(el('span', {}, summary));
  if (isCollapsible) {
    header.style.cursor = 'pointer';
    header.onclick = handleToggle;
  }
  return header;
}

async function renderRecords() {
  await load();
  const root = document.getElementById('view');
  root.innerHTML = '';

  const wrap = el('div', { style: 'padding-top: 8px;' });

  // 搜索栏：input 一旦创建就不重渲染（关键修复：解决失焦问题）
  const searchBar = el('div', { class: 'search-bar' });
  const searchInput = el('input', {
    type: 'search',
    placeholder: '搜索描述、类型或原文',
    value: search
  });
  // 关键修复：input 事件 + 状态更新时不重渲染 input
  searchInput.oninput = (e) => {
    search = e.target.value;
    // 只更新列表 + summary，不重渲染整个 searchBar
    rerenderListOnly();
  };
  searchBar.appendChild(searchInput);
  wrap.appendChild(searchBar);

  // 按时间段筛选
  const today = new Date();
  const monthAgo = new Date(); monthAgo.setMonth(today.getMonth() - 1);
  if (!rangeStart) rangeStart = monthAgo.toISOString().slice(0, 10);
  if (!rangeEnd) rangeEnd = today.toISOString().slice(0, 10);

  const toggle = el('label', { class: 'filter-toggle' });
  toggle.appendChild(el('input', {
    type: 'checkbox',
    checked: useDateRange,
    onchange: (e) => { useDateRange = e.target.checked; rerenderListOnly(); }
  }));
  toggle.appendChild(document.createTextNode('按时间段筛选'));
  wrap.appendChild(toggle);

  if (useDateRange) {
    const range = el('div', { class: 'date-range' });
    range.appendChild(el('span', {}, '起'));
    range.appendChild(el('input', {
      type: 'date',
      value: rangeStart,
      onchange: (e) => { rangeStart = e.target.value; rerenderListOnly(); }
    }));
    range.appendChild(el('span', {}, '止'));
    range.appendChild(el('input', {
      type: 'date',
      value: rangeEnd,
      onchange: (e) => { rangeEnd = e.target.value; rerenderListOnly(); }
    }));
    wrap.appendChild(range);
  }

  // 列表 + 顶部汇总区域（动态重渲染部分）
  const listContainer = el('div', { id: 'records-list-container' });
  wrap.appendChild(listContainer);

  root.appendChild(wrap);

  // 初次渲染列表
  rerenderListOnly();

  function rerenderListOnly() {
    // 只重渲染汇总 + 列表，搜索框 / 时间筛选不动
    renderListInto(listContainer);
  }

  function renderListInto(container) {
    container.innerHTML = '';

    const recs = filtered();
    const total = recs.reduce((s, r) => s + Number(r.amount), 0);
    container.appendChild(el('div', { class: 'summary-line' },
      el('span', {}, `共 ${recs.length} 笔 · 合计 ¥${fmtMoney(total)}`),
      el('div', { style: 'display:flex; gap:8px; align-items:center;' },
        el('button', {
          class: 'export-btn',
          onclick: () => {
            const stamp = new Date().toISOString().slice(0, 10);
            exportCSV(recs, [
              { key: 'timestamp', label: '消费时间', format: (v) => new Date(v).toLocaleString('zh-CN') },
              { key: 'category', label: '类别' },
              { key: 'description', label: '描述' },
              { key: 'amount', label: '金额(元)' },
              { key: 'rawInput', label: '原始输入' }
            ], 'ledgerly_' + stamp + '.csv');
          }
        }, '📤 导出')
      )
    ));

    if (!recs.length) {
      container.appendChild(el('div', { class: 'empty' },
        el('div', { class: 'ico' }, '📋'),
        el('div', {}, '暂无记录')
      ));
      return;
    }

    // 按月分组，月内再按日分组
    const months = groupByMonth(recs);
    for (const [ym, items] of months) {
      const monthTotal = items.reduce((s, r) => s + Number(r.amount), 0);
      const monthKey = 'month:' + ym;
      const monthHeader = makeGroupHeader({
        key: monthKey,
        label: formatMonthHeader(ym) + ' · ' + items.length + ' 笔',
        summary: '合计 ¥' + fmtMoney(monthTotal),
        onToggle: rerenderListOnly,
        kind: 'month'
      });
      container.appendChild(monthHeader);

      // 如果月没折叠，才显示月内的日
      if (!isCollapsed(monthKey, "month")) {
        const days = groupByDay(items);
        for (const [day, dayItems] of days) {
          const dayTotal = dayItems.reduce((s, r) => s + Number(r.amount), 0);
          const dayKey = 'day:' + day;
          const dayHeader = makeGroupHeader({
            key: dayKey,
            label: formatDayHeader(day) + ' · ' + dayItems.length + ' 笔',
            summary: '合计 ¥' + fmtMoney(dayTotal),
            onToggle: rerenderListOnly,
            kind: 'day'
          });
          container.appendChild(dayHeader);
          // 日强制展开（不需要判断 isCollapsed）
          for (const r of dayItems) container.appendChild(renderRow(r));
        }
      }
    }
  }
}

function renderRow(r) {
  const ts = new Date(r.timestamp);
  return el('div', { class: 'record-row' },
    el('div', { class: 'ico' }, catIcon(r.category)),
    el('div', { class: 'body' },
      el('div', { class: 'name' }, r.description),
      el('div', { class: 'meta' },
        el('div', { class: 'cat' }, r.category),
        el('div', {}, fmtMonthDay(r.timestamp) + ' ' + String(ts.getHours()).padStart(2, '0') + ':' + String(ts.getMinutes()).padStart(2, '0'))
      )
    ),
    el('div', { class: 'amount' }, '¥' + fmtMoney(r.amount)),
    el('button', {
      class: 'delete-row-btn',
      title: '删除这条记录',
      onclick: async (e) => {
        e.stopPropagation();
        if (!confirm('确定删除「' + r.description + '」？')) return;
        try {
          await DB.remove(r.id);
          showToast('已删除');
          // 删除后重新渲染列表（不要 rerenderRecords，会重置搜索框）
          const container = document.getElementById('records-list-container');
          if (container) {
            await load();
            // 模拟构造一个内部函数调用：简单实现是直接调 renderListInto
            renderListOnly(container);
          }
        } catch (err) {
          showToast('删除失败：' + err.message);
        }
      }
    }, '🗑')
  );
}

// 删除后用的轻量刷新函数（从 renderRecords 里复制出来独立定义）
function renderListOnly(container) {
  container.innerHTML = '';
  const recs = filtered();
  const total = recs.reduce((s, r) => s + Number(r.amount), 0);
  container.appendChild(el('div', { class: 'summary-line' },
    el('span', {}, `共 ${recs.length} 笔 · 合计 ¥${fmtMoney(total)}`),
    el('button', {
      class: 'export-btn',
      onclick: () => {
        const stamp = new Date().toISOString().slice(0, 10);
        exportCSV(recs, [
          { key: 'timestamp', label: '消费时间', format: (v) => new Date(v).toLocaleString('zh-CN') },
          { key: 'category', label: '类别' },
          { key: 'description', label: '描述' },
          { key: 'amount', label: '金额(元)' },
          { key: 'rawInput', label: '原始输入' }
        ], 'ledgerly_' + stamp + '.csv');
      }
    }, '📤 导出')
  ));
  if (!recs.length) {
    container.appendChild(el('div', { class: 'empty' },
      el('div', { class: 'ico' }, '📋'),
      el('div', {}, '暂无记录')
    ));
    return;
  }

  // 按月分组，月内再按日分组
  const months = groupByMonth(recs);
  for (const [ym, items] of months) {
    const monthTotal = items.reduce((s, r) => s + Number(r.amount), 0);
    const monthKey = 'month:' + ym;
    const monthHeader = makeGroupHeader({
      key: monthKey,
      label: formatMonthHeader(ym) + ' · ' + items.length + ' 笔',
      summary: '合计 ¥' + fmtMoney(monthTotal),
      onToggle: () => renderListOnly(container),
      kind: 'month'
    });
    container.appendChild(monthHeader);

    // 月没折叠才显示月内
    if (!isCollapsed(monthKey, "month")) {
      const days = groupByDay(items);
      for (const [day, dayItems] of days) {
        const dayTotal = dayItems.reduce((s, r) => s + Number(r.amount), 0);
        const dayKey = 'day:' + day;
        const dayHeader = makeGroupHeader({
          key: dayKey,
          label: formatDayHeader(day) + ' · ' + dayItems.length + ' 笔',
          summary: '合计 ¥' + fmtMoney(dayTotal),
          onToggle: () => renderListOnly(container),
          kind: 'day'
        });
        container.appendChild(dayHeader);
        // 日强制展开（不需要判断 isCollapsed）
        for (const r of dayItems) container.appendChild(renderRow(r));
      }
    }
  }
}
window.renderRecords = renderRecords;

})();

// === js/views/settings.js ===
(function() {
const Settings = window.Settings;
const { testConnection } = window.LLM;
const { el, showToast, exportCSV, parseCSV, parseAmount, parseDate } = window.Util;
const DB = window.DB;




async function renderSettings() {
  const root = document.getElementById('view');
  root.innerHTML = '';

  const wrap = el('div', { style: 'padding-top: 8px;' });

  // 状态
  let testing = false;
  let lastResult = null;
  let formValues = {
    baseURL: Settings.baseURL,
    apiKey: Settings.apiKey,
    model: Settings.model
  };

  function checkConfigured() {
    return !!formValues.baseURL.trim() && !!formValues.apiKey.trim() && !!formValues.model.trim();
  }

  // 状态卡
  wrap.appendChild(el('div', { class: 'section' },
    el('div', { class: 'field' },
      el('div', { style: 'display:flex; align-items:center; gap:6px;' },
        el('span', { style: 'color:#2f9e44; font-size: 16px;' }, '✅'),
        el('span', { style: 'font-weight: 500;' }, '配置已就绪（下方可随时修改）')
      )
    )
  ));

  // 配置
  const sec1 = el('div', { class: 'section' });
  sec1.appendChild(el('h3', {}, '大模型配置（OpenAI 兼容）'));

  const f1 = el('div', { class: 'field' });
  f1.appendChild(el('label', {}, 'Base URL'));
  const i1 = el('input', {
    type: 'url', value: formValues.baseURL, autocomplete: 'off',
    oninput: (e) => { formValues.baseURL = e.target.value.trim(); }
  });
  f1.appendChild(i1);
  sec1.appendChild(f1);

  const f2 = el('div', { class: 'field' });
  f2.appendChild(el('label', {}, 'API Key'));
  const i2 = el('input', {
    type: 'password', value: formValues.apiKey, autocomplete: 'off',
    oninput: (e) => { formValues.apiKey = e.target.value.trim(); }
  });
  f2.appendChild(i2);
  sec1.appendChild(f2);

  const f3 = el('div', { class: 'field' });
  f3.appendChild(el('label', {}, 'Model'));
  const i3 = el('input', {
    type: 'text', value: formValues.model, autocomplete: 'off',
    oninput: (e) => { formValues.model = e.target.value.trim(); }
  });
  f3.appendChild(i3);
  sec1.appendChild(f3);
  wrap.appendChild(sec1);

  // 测试连接
  const sec2 = el('div', { class: 'section' });
  const testBtn = el('button', { class: 'btn-primary', onclick: runTest }, '测试连接');
  sec2.appendChild(testBtn);
  sec2.appendChild(el('div', { class: 'footer' },
    '测试会向 LLM 发起一次真实请求，验证 API Key 与模型名是否可用。'
  ));
  wrap.appendChild(sec2);

  // 示例
  const sec4 = el('div', { class: 'section' });
  sec4.appendChild(el('h3', {}, '常用 Base URL 示例'));
  for (const u of [
    'OpenAI: https://api.openai.com/v1',
    'DeepSeek: https://api.deepseek.com/v1',
    'Moonshot: https://api.moonshot.cn/v1',
    '智谱 GLM: https://open.bigmodel.cn/api/paas/v4'
  ]) sec4.appendChild(el('div', { class: 'footer' }, u));
  wrap.appendChild(sec4);

  // 关于
  const sec5 = el('div', { class: 'section' });
  sec5.appendChild(el('h3', {}, '关于'));
  sec5.appendChild(el('div', { class: 'field' },
    el('div', {}, 'Ledgerly PWA · v1.0'),
    el('div', { class: 'footer', style: 'margin-top:4px;' },
      '数据存储于浏览器 IndexedDB，可在 Safari/Chrome 安装到桌面')
  ));
  wrap.appendChild(sec5);

  // 数据备份与恢复
  const sec6 = el('div', { class: 'section' });
  sec6.appendChild(el('h3', {}, '数据备份与恢复'));
  sec6.appendChild(el('div', { style: 'display:flex; gap:8px; flex-wrap:wrap;' },
    el('button', {
      class: 'btn-primary',
      style: 'flex:1; min-width:140px;',
      onclick: exportAllData
    }, '📤 导出 CSV'),
    el('input', {
      type: 'file', accept: '.csv,text/csv',
      style: 'display:none', id: 'csv-import-input-settings'
    }),
    el('button', {
      class: 'btn-primary',
      style: 'flex:1; min-width:140px; background:#2f9e44;',
      onclick: () => {
        const inp = document.getElementById('csv-import-input-settings');
        if (inp) inp.click();
      }
    }, '📥 导入 CSV')
  ));
  sec6.appendChild(el('div', { class: 'footer', style: 'margin-top:6px;' },
    '💡 备份流程：导出 CSV → 保存到云端 → 卸载 PWA → 装新 PWA → 设置页导入'
  ));
  sec6.appendChild(el('div', { class: 'footer', style: 'margin-top:4px; color:#2f9e44;' },
    '✅ 导入时自动去重（同时间+描述+金额视为重复）'
  ));
  sec6.appendChild(el('div', { class: 'footer', style: 'margin-top:8px; color:#f08c00;' },
    '⚠️ Safari「清除网站数据」/ 卸载 PWA 会清空 IndexedDB，请定期备份！'
  ));
  wrap.appendChild(sec6);

  // 数据完整性（先 await，再渲染）
  let dataStatus = { count: 0, latest: '无' };
  try {
    const all = await DB.getAll();
    dataStatus.count = all.length;
    if (all.length) {
      const latest = all.reduce((m, r) => r.createdAt > m ? r.createdAt : m, all[0].createdAt);
      dataStatus.latest = new Date(latest).toLocaleString('zh-CN');
    }
  } catch (e) {
    dataStatus = { count: -1, latest: '读取失败：' + e.message };
  }

  const sec7 = el('div', { class: 'section' });
  sec7.appendChild(el('h3', {}, '📊 数据完整性'));
  sec7.appendChild(el('div', { class: 'field' },
    el('div', { style: 'display:flex; justify-content:space-between; padding:4px 0;' },
      el('span', { class: 'muted' }, '当前记录数'),
      el('span', { style: 'font-weight:600; font-size:16px;' },
        dataStatus.count >= 0 ? dataStatus.count + ' 条' : '读取失败')
    ),
    el('div', { style: 'display:flex; justify-content:space-between; padding:4px 0;' },
      el('span', { class: 'muted' }, '最近写入'),
      el('span', { style: 'font-size:13px;' }, dataStatus.latest)
    )
  ));
  sec7.appendChild(el('div', { class: 'footer', style: 'margin-top:8px;' },
    '💡 升级 PWA 后回来对比这两个数字，应该保持不变。'
  ));
  sec7.appendChild(el('div', { class: 'footer', style: 'margin-top:4px; color:#2f9e44;' },
    '✅ PWA 应用更新不会清空数据（IndexedDB 与 SW 缓存独立）。'
  ));
  wrap.appendChild(sec7);

  root.appendChild(wrap);

  // CSV 导入 input 绑定
  const csvInput = document.getElementById('csv-import-input-settings');
  if (csvInput) {
    csvInput.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) importAllData(file);
      csvInput.value = '';
    };
  }

  // ============ 内部函数 ============

  async function exportAllData() {
    try {
      const all = await DB.getAll();
      const stamp = new Date().toISOString().slice(0, 10);
      exportCSV(all, [
        { key: 'timestamp', label: '消费时间', format: (v) => new Date(v).toLocaleString('zh-CN') },
        { key: 'category', label: '类别' },
        { key: 'description', label: '描述' },
        { key: 'amount', label: '金额(元)' },
        { key: 'rawInput', label: '原始输入' }
      ], 'ledgerly_full_backup_' + stamp + '.csv');
    } catch (e) {
      showToast('导出失败：' + e.message);
    }
  }

  async function importAllData(file) {
    try {
      // 优先用 UTF-8 读，失败回退 GBK（Numbers 中文导出有时用 Mac Roman / GBK）
      let text;
      try {
        text = await file.text();
        // 简单的"看起来是中文乱码"检测：UTF-8 里不应该有 "Ã©" "â€" 这类序列
        if (/[Ã©â‚¬]/.test(text)) throw new Error('encoding');
      } catch (e) {
        text = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result || ''));
          r.onerror = () => reject(r.error);
          r.readAsText(file, 'GBK');
        });
      }
      const { headers, rows } = parseCSV(text);
      if (!rows.length) { showToast('CSV 没有数据'); return; }
      const colMap = {};
      headers.forEach(h => {
        const lh = h.trim().toLowerCase();
        if (lh.includes('时间') || lh.includes('日期') || lh === 'timestamp' || lh === 'date') colMap.timestamp = h;
        if (lh.includes('类别') || lh === 'category' || lh === 'cat' || lh === 'type') colMap.category = h;
        if (lh.includes('描述') || lh === 'description' || lh === 'desc' || lh === 'note') colMap.description = h;
        if (lh.includes('金额') || lh === 'amount' || lh === 'value' || lh === 'price') colMap.amount = h;
        if (lh.includes('原始') || lh === 'rawinput' || lh === 'raw' || lh === 'input') colMap.rawInput = h;
      });
      if (!colMap.amount) {
        // 尝试自动猜测：第一列（除标题外）通常含数字 → 假设是金额
        const numericCols = headers.filter(h => {
          const sample = rows.slice(0, 3).map(r => r[h]).join(',');
          return parseAmount(sample) > 0;
        });
        if (numericCols.length) {
          colMap.amount = numericCols[0];
          showToast('自动识别金额列：' + colMap.amount);
        } else {
          showToast('找不到金额列，请检查 CSV 文件');
          return;
        }
      }
      const existing = await DB.getAll();
      const existingKeys = new Set(existing.map(r =>
        (r.timestamp || '') + '|' + (r.description || '') + '|' + String(r.amount)
      ));
      let added = 0, skipped = 0;
      for (const row of rows) {
        const amount = parseAmount(row[colMap.amount]);
        if (!amount || amount <= 0) { skipped++; continue; }
        const tsRaw = row[colMap.timestamp] || '';
        let parsedDate = parseDate(tsRaw);
        let tsIso = parsedDate ? parsedDate.toISOString() : new Date().toISOString();
        const desc = (row[colMap.description] || row[colMap.category] || '导入').trim() || '导入';
        const key = tsIso + '|' + desc + '|' + String(amount);
        if (existingKeys.has(key)) { skipped++; continue; }
        await DB.add({
          id: crypto.randomUUID(),
          timestamp: tsIso,
          category: (row[colMap.category] || '其他').trim() || '其他',
          amount: amount,
          description: desc,
          rawInput: (row[colMap.rawInput] || '[CSV导入]').trim(),
          createdAt: new Date().toISOString()
        });
        existingKeys.add(key);
        added++;
      }
      showToast('导入完成：' + added + ' 条新增，' + skipped + ' 条跳过');
    } catch (e) {
      showToast('导入失败：' + e.message);
    }
  }

  async function runTest() {
    if (!checkConfigured() || testing) return;
    Settings.baseURL = formValues.baseURL;
    Settings.apiKey = formValues.apiKey;
    Settings.model = formValues.model;
    testing = true;
    lastResult = null;
    testBtn.disabled = true;
    testBtn.textContent = '测试中...';
    try {
      const r = await testConnection();
      lastResult = { success: true, msg: '✅ 连接成功：' + r.category + ' ¥' + r.amount + ' · ' + r.description };
    } catch (e) {
      lastResult = { success: false, msg: '❌ ' + (e.message || String(e)) };
    }
    testing = false;
    testBtn.disabled = false;
    testBtn.textContent = '测试连接';
    if (lastResult) {
      let line = sec2.querySelector('.test-result');
      if (!line) {
        line = el('div', { class: 'footer test-result', style: 'margin-top:8px;' });
        sec2.appendChild(line);
      }
      line.style.color = lastResult.success ? '#2f9e44' : '#d6336c';
      line.textContent = lastResult.msg;
    }
  }
}
window.renderSettings = renderSettings;

})();

// === js/app.js ===
(function() {

// Main app router. Registers service worker and renders the active tab.

// render functions are exposed on window by build.py (see IIFE module exports list).
// We wrap them in arrow functions so RENDERERS[name]() is safe to call even if window.renderX isn't ready yet.

const TITLES = {
  input: '记一笔',
  stats: '统计',
  records: '明细',
  settings: '设置'
};

const RENDERERS = {
  input: () => window.renderInput && window.renderInput(),
  stats: () => window.renderStats && window.renderStats(),
  records: () => window.renderRecords && window.renderRecords(),
  settings: () => window.renderSettings && window.renderSettings()
};

let activeTab = 'input';

function setActiveTab(name) {
  activeTab = name;
  document.getElementById('page-title').textContent = TITLES[name] || '';
  for (const btn of document.querySelectorAll('.tab')) {
    btn.classList.toggle('active', btn.dataset.tab === name);
  }
  const view = document.getElementById('view');
  view.innerHTML = '';
  try {
    RENDERERS[name] && RENDERERS[name]();
  } catch (err) {
    view.innerHTML = '';
    const pre = document.createElement('pre');
    pre.style.cssText = 'padding:16px; color:#d6336c; font-size:11px; white-space:pre-wrap; word-break:break-all; background:#fff5f5; margin:12px; border-radius:8px;';
    pre.textContent = '渲染 ' + name + ' 出错：\n' + (err && err.stack ? err.stack : String(err));
    view.appendChild(pre);
  }
  // 滚动到顶部，方便看新内容（设置页内容长，避免用户找不到底部）
  const scrollParent = document.querySelector('main#view .scroll') || document.getElementById('view');
  if (scrollParent) scrollParent.scrollTop = 0;
  window.scrollTo(0, 0);
}

function setupTabs() {
  for (const btn of document.querySelectorAll('.tab')) {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  }
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  registerSW();
  setActiveTab('input');
});

// 兜底：DOMContentLoaded 错过时也能跑
window.addEventListener('load', () => {
  if (!document.getElementById('view').hasChildNodes()) {
    setActiveTab('input');
  }
});

window.setActiveTab = setActiveTab;

})();
