// Shared helpers used by views.

export function fmtMoney(d) {
  const n = Number(d);
  if (!isFinite(n)) return '0';
  const parts = n.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

export function fmtDate(d, withTime = true) {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  const h = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return withTime ? `${y}-${m}-${day} ${h}:${mi}` : `${y}-${m}-${day}`;
}

export function fmtMonthDay(d) {
  const dt = new Date(d);
  return `${dt.getMonth() + 1}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function fmtYM(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

const CAT_ICONS = {
  '餐饮': '🍴', '交通': '🚗', '购物': '🛍', '娱乐': '🎮',
  '住房': '🏠', '医疗': '➕', '教育': '🎓', '其他': '·'
};

export function catIcon(c) {
  return CAT_ICONS[c] || '·';
}

export function startOfDay(d) {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

export function startOfWeek(d) {
  const dt = startOfDay(d);
  const day = dt.getDay(); // 0..6 (Sun..Sat)
  const delta = (day + 6) % 7; // Monday-based start
  dt.setDate(dt.getDate() - delta);
  return dt;
}

export function startOfMonth(d) {
  const dt = startOfDay(d);
  dt.setDate(1);
  return dt;
}

export function startOfYear(d) {
  const dt = startOfDay(d);
  dt.setMonth(0, 1);
  return dt;
}

export function isoNow() {
  return new Date().toISOString();
}

export function showToast(msg, ms = 2400) {
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

export function el(tag, attrs = {}, ...children) {
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
export function exportCSV(records, columns, filename) {
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
export function parseCSV(text) {
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
export function parseAmount(s) {
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
export function parseDate(s) {
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
