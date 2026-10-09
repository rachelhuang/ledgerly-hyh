// Main app router. Registers service worker and renders the active tab.

import { renderInput } from './views/input.js';
import { renderStats } from './views/stats.js';
import { renderRecords } from './views/records.js';
import { renderSettings } from './views/settings.js';

const TITLES = {
  input: '记一笔',
  stats: '统计',
  records: '明细',
  settings: '设置'
};

const RENDERERS = {
  input: renderInput,
  stats: renderStats,
  records: renderRecords,
  settings: renderSettings
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
