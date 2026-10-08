import * as DB from '../db.js';
import { el, fmtMoney, fmtYM, fmtMonthDay, showToast, startOfWeek, startOfMonth, startOfYear, startOfDay } from '../util.js';

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
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const padL = 44, padR = 16, padT = 16, padB = 28;
  const W0 = W - padL - padR, H0 = H - padT - padB;

  ctx.clearRect(0, 0, W, H);

  if (!points.length) return;

  const maxV = Math.max(...points.map(p => p.total), 1);
  const xStep = points.length > 1 ? W0 / (points.length - 1) : 0;
  const yFor = v => padT + H0 - (v / maxV) * H0;

  // grid
  ctx.strokeStyle = '#eee';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (H0 * i / 4);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + W0, y);
    ctx.stroke();
    ctx.fillStyle = '#999';
    ctx.font = '10px -apple-system';
    ctx.textAlign = 'right';
    ctx.fillText(String(Math.round(maxV * (1 - i / 4))), padL - 6, y + 3);
  }

  // line
  ctx.strokeStyle = '#3c5066';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = padL + i * xStep;
    const y = yFor(p.total);
    if (i === 0) ctx.moveTo(x, y);
    else {
      const px = padL + (i - 1) * xStep;
      const py = yFor(points[i - 1].total);
      const mx = (px + x) / 2;
      ctx.bezierCurveTo(mx, py, mx, y, x, y);
    }
  });
  ctx.stroke();

  // points (only > 0)
  ctx.fillStyle = '#3c5066';
  points.forEach((p, i) => {
    if (p.total <= 0) return;
    const x = padL + i * xStep;
    const y = yFor(p.total);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // x labels (sample 6 evenly)
  ctx.fillStyle = '#666';
  ctx.font = '10px -apple-system';
  ctx.textAlign = 'center';
  const labelCount = Math.min(6, points.length);
  for (let i = 0; i < labelCount; i++) {
    const idx = Math.round((points.length - 1) * (i / Math.max(1, labelCount - 1)));
    const p = points[idx];
    const x = padL + idx * xStep;
    ctx.fillText(labelFmt(p.date), x, padT + H0 + 14);
  }

  // hover / drag
  canvas.onmousemove = canvas.ontouchmove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    if (cx < padL || cx > padL + W0) return;
    const ratio = (cx - padL) / W0;
    const idx = Math.round(ratio * (points.length - 1));
    const nearest = points
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.total > 0)
      .sort((a, b) => Math.abs(a.i - idx) - Math.abs(b.i - idx))[0];
    if (!nearest) return;
    showTooltip(canvas, nearest.p, labelFmt, isYear);
  };
  canvas.onmouseleave = canvas.ontouchend = () => {
    hideTooltip();
  };
}

let _tooltip = null;
function ensureTooltip() {
  if (!_tooltip) {
    _tooltip = el('div', { class: 'chart-tooltip', style: 'display:none' });
    document.body.appendChild(_tooltip);
  }
  return _tooltip;
}
function showTooltip(canvas, point, labelFmt, isYear) {
  const tip = ensureTooltip();
  const dateStr = isYear
    ? `${point.date.getFullYear()}年${point.date.getMonth() + 1}月`
    : `${point.date.getMonth() + 1}月${point.date.getDate()}日`;
  tip.innerHTML = `<div style="color:#666;">${dateStr}</div><div style="font-weight:600;">¥${fmtMoney(point.total)}</div>`;
  const rect = canvas.getBoundingClientRect();
  const padL = 44;
  const W0 = rect.width - padL - 16;
  const xStep = W0 / Math.max(1, bucketize().find(b => b.key === selectedBucketKey)?.items.length || 1);
  const ratio = (point.date - new Date(bucketize()[0]?.key || Date.now())) / (1000 * 86400);
  // simple approx positioning
  tip.style.left = (rect.left + padL + (xStep * indexOf(bucketize().find(b => b.key === selectedBucketKey)?.items, point))) + 'px';
  tip.style.top = (rect.top + 14) + 'px';
  tip.style.display = 'block';
}

function indexOf(arr, item) {
  if (!arr) return 0;
  const day = item.date.toISOString().slice(0, 10);
  return arr.findIndex(r => new Date(r.timestamp).toISOString().slice(0, 10) === day);
}

function hideTooltip() {
  if (_tooltip) _tooltip.style.display = 'none';
}

function renderStatCard(label, value, klass) {
  return el('div', { class: 'stat ' + klass },
    el('div', { class: 'label' }, label),
    el('div', { class: 'value' }, value)
  );
}

export async function renderStats() {
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
      el('div', { class: 'top-amount' }, '¥' + fmtMoney(r.amount))
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
