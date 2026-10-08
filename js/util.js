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
