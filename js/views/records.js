import * as DB from '../db.js';
import { el, fmtMoney, fmtDate, fmtYM, fmtMonthDay, catIcon, startOfDay, showToast, exportCSV } from '../util.js';

let allRecords = [];
let search = '';
let useDateRange = false;
let rangeStart = '';
let rangeEnd = '';
let groupMode = 'day'; // 'day' | 'month'

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

function makeGroupHeader({ key, label, summary, color = 'var(--accent)' }) {
  const isCollapsed = collapsedMap.has(key);
  const header = el('div', { class: 'day-section collapsible' });
  const left = el('span', { style: 'display:flex; align-items:center; gap:6px; flex:1;' },
    el('span', {
      class: 'caret',
      style: 'font-size:10px; transition: transform 0.15s; display:inline-block; width:10px;',
      onclick: () => {
        if (collapsedMap.has(key)) collapsedMap.delete(key);
        else collapsedMap.add(key);
        rerenderListOnly();
      }
    }, isCollapsed ? '▶' : '▼'),
    el('span', {}, label)
  );
  header.appendChild(left);
  header.appendChild(el('span', {}, summary));
  header.style.cursor = 'pointer';
  // 整行可点击
  header.onclick = (e) => {
    if (e.target.className === 'caret') return;  // 让 caret 自己的 onclcik 处理
    if (collapsedMap.has(key)) collapsedMap.delete(key);
    else collapsedMap.add(key);
    rerenderListOnly();
  };
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
        // 分组方式切换
        (() => {
          const tabs = el('div', { class: 'group-tabs' });
          for (const [mode, label] of [['day', '按日'], ['month', '按月']]) {
            tabs.appendChild(el('button', {
              class: mode === groupMode ? 'active' : '',
              onclick: () => { groupMode = mode; renderListInto(container); }
            }, label));
          }
          return tabs;
        })(),
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

    if (groupMode === 'day') {
      const days = groupByDay(recs);
      for (const [day, items] of days) {
        const dayTotal = items.reduce((s, r) => s + Number(r.amount), 0);
        const key = 'day:' + day;
        const header = makeGroupHeader({
          key,
          label: formatDayHeader(day) + ' · ' + items.length + ' 笔',
          summary: '合计 ¥' + fmtMoney(dayTotal)
        });
        container.appendChild(header);
        if (!collapsedMap.has(key)) {
          for (const r of items) container.appendChild(renderRow(r));
        }
      }
    } else {
      // 按月分组
      const months = groupByMonth(recs);
      for (const [ym, items] of months) {
        const monthTotal = items.reduce((s, r) => s + Number(r.amount), 0);
        const key = 'month:' + ym;
        const header = makeGroupHeader({
          key,
          label: formatMonthHeader(ym) + ' · ' + items.length + ' 笔',
          summary: '合计 ¥' + fmtMoney(monthTotal)
        });
        container.appendChild(header);
        if (!collapsedMap.has(key)) {
          for (const r of items) container.appendChild(renderRow(r));
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
    el('div', { style: 'display:flex; gap:8px; align-items:center;' },
      (() => {
        const tabs = el('div', { class: 'group-tabs' });
        for (const [mode, label] of [['day', '按日'], ['month', '按月']]) {
          tabs.appendChild(el('button', {
            class: mode === groupMode ? 'active' : '',
            onclick: () => { groupMode = mode; renderListOnly(container); }
          }, label));
        }
        return tabs;
      })(),
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
  if (groupMode === 'day') {
    const days = groupByDay(recs);
    for (const [day, items] of days) {
      const dayTotal = items.reduce((s, r) => s + Number(r.amount), 0);
      const key = 'day:' + day;
      const header = makeGroupHeader({
        key,
        label: formatDayHeader(day) + ' · ' + items.length + ' 笔',
        summary: '合计 ¥' + fmtMoney(dayTotal)
      });
      container.appendChild(header);
      if (!collapsedMap.has(key)) {
        for (const r of items) container.appendChild(renderRow(r));
      }
    }
  } else {
    const months = groupByMonth(recs);
    for (const [ym, items] of months) {
      const monthTotal = items.reduce((s, r) => s + Number(r.amount), 0);
      const key = 'month:' + ym;
      const header = makeGroupHeader({
        key,
        label: formatMonthHeader(ym) + ' · ' + items.length + ' 笔',
        summary: '合计 ¥' + fmtMoney(monthTotal)
      });
      container.appendChild(header);
      if (!collapsedMap.has(key)) {
        for (const r of items) container.appendChild(renderRow(r));
      }
    }
  }
}