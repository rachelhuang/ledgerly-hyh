import * as DB from '../db.js';
import { el, fmtMoney, fmtDate, fmtYM, fmtMonthDay, catIcon, startOfDay, showToast, exportCSV } from '../util.js';

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
  const header = el('div', { class: 'day-section collapsible' });
  const left = el('span', { style: 'display:flex; align-items:center; gap:6px; flex:1;' },
    el('span', {
      class: 'caret',
      style: 'font-size:10px; transition: transform 0.15s; display:inline-block; width:10px;',
      onclick: (e) => { e.stopPropagation(); handleToggle(); }
    }, collapsed ? '▶' : '▼'),
    el('span', {}, label)
  );
  header.appendChild(left);
  header.appendChild(el('span', {}, summary));
  header.style.cursor = 'pointer';
  header.onclick = handleToggle;
  return header;
}

export async function renderRecords() {
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
        onToggle: rerenderListOnly
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
            onToggle: rerenderListOnly
          });
          container.appendChild(dayHeader);
          // 日也支持折叠（虽然默认展开）
          if (!isCollapsed(dayKey, "day")) {
            for (const r of dayItems) container.appendChild(renderRow(r));
          }
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
      onToggle: () => renderListOnly(container)
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
          onToggle: () => renderListOnly(container)
        });
        container.appendChild(dayHeader);
        // 日也支持折叠（虽然默认展开）
        if (!isCollapsed(dayKey, "day")) {
          for (const r of dayItems) container.appendChild(renderRow(r));
        }
      }
    }
  }
}