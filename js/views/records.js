import * as DB from '../db.js';
import { el, fmtMoney, fmtDate, fmtYM, fmtMonthDay, catIcon, startOfDay, showToast, exportCSV } from '../util.js';

let allRecords = [];
let search = '';
let useRange = false;
let rangeStart = '';
let rangeEnd = '';

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
  if (!useRange) return true;
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

export async function renderRecords() {
  await load();
  const root = document.getElementById('view');
  root.innerHTML = '';

  const wrap = el('div', { style: 'padding-top: 8px;' });

  // search bar
  const searchBar = el('div', { class: 'search-bar' });
  const searchInput = el('input', {
    type: 'search',
    placeholder: '搜索描述、类型或原文',
    value: search,
    oninput: (e) => { search = e.target.value; rerender(); }
  });
  searchBar.appendChild(searchInput);
  wrap.appendChild(searchBar);

  // filter toggle
  const today = new Date();
  const monthAgo = new Date(); monthAgo.setMonth(today.getMonth() - 1);
  if (!rangeStart) rangeStart = monthAgo.toISOString().slice(0, 10);
  if (!rangeEnd) rangeEnd = today.toISOString().slice(0, 10);

  const toggle = el('label', { class: 'filter-toggle' });
  toggle.appendChild(el('input', {
    type: 'checkbox',
    checked: useRange,
    onchange: (e) => { useRange = e.target.checked; rerender(); }
  }));
  toggle.appendChild(document.createTextNode('按时间段筛选'));
  wrap.appendChild(toggle);

  if (useRange) {
    const range = el('div', { class: 'date-range' });
    range.appendChild(el('span', {}, '起'));
    range.appendChild(el('input', {
      type: 'date',
      value: rangeStart,
      onchange: (e) => { rangeStart = e.target.value; rerender(); }
    }));
    range.appendChild(el('span', {}, '止'));
    range.appendChild(el('input', {
      type: 'date',
      value: rangeEnd,
      onchange: (e) => { rangeEnd = e.target.value; rerender(); }
    }));
    wrap.appendChild(range);
  }

  const recs = filtered();
  const total = recs.reduce((s, r) => s + Number(r.amount), 0);
  wrap.appendChild(el('div', { class: 'summary-line' },
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
    }, '📤 导出 CSV')
  ));

  if (!recs.length) {
    wrap.appendChild(el('div', { class: 'empty' },
      el('div', { class: 'ico' }, '📋'),
      el('div', {}, '暂无记录')
    ));
  } else {
    const days = groupByDay(recs);
    for (const [day, items] of days) {
      const dayTotal = items.reduce((s, r) => s + Number(r.amount), 0);
      const header = el('div', { class: 'day-section' },
        el('span', {}, fmtYM(day) + '-' + String(new Date(day).getDate()).padStart(2, '0')),
        el('span', {}, '合计 ¥' + fmtMoney(dayTotal))
      );
      wrap.appendChild(header);
      for (const r of items) {
        wrap.appendChild(renderRow(r));
      }
    }
  }

  root.appendChild(wrap);

  function rerender() {
    renderRecords();
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
          await renderRecords();
        } catch (err) {
          showToast('删除失败：' + err.message);
        }
      }
    }, '🗑')
  );
}
