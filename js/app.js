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
  RENDERERS[name] && RENDERERS[name]();
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
