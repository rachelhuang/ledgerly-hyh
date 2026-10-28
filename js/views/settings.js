import { Settings } from '../settings.js';
import { testConnection } from '../llm.js';
import { el, showToast, exportCSV, parseCSV, parseAmount, parseDate } from '../util.js';
import * as DB from '../db.js';
export async function renderSettings() {
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

  // 数据救援（数据库异常时的自救工具）
  const sec8 = el('div', { class: 'section' });
  sec8.appendChild(el('h3', {}, '🔧 数据救援'));
  sec8.appendChild(el('div', { style: 'display:flex; gap:8px; flex-wrap:wrap;' },
    el('button', {
      class: 'btn-primary',
      style: 'flex:1; min-width:140px; background:#f08c00;',
      onclick: diagnoseDB
    }, '🔍 诊断数据库'),
    el('button', {
      class: 'btn-primary',
      style: 'flex:1; min-width:140px; background:#4c6ef5;',
      onclick: rescueExport
    }, '💾 原始数据导出')
  ));
  sec8.appendChild(el('div', { class: 'footer', style: 'margin-top:6px;' },
    '💡 数据库异常时，先「原始数据导出」把数据抢救出来，再考虑修复。'
  ));
  sec8.appendChild(el('button', {
    class: 'btn-secondary-danger',
    style: 'width:100%; margin-top:8px; background:transparent; color:var(--red); border:1px solid var(--red); padding:8px; border-radius:8px; font-size:13px; cursor:pointer;',
    onclick: forceRepair
  }, '⚠️ 强制修复（会清空当前数据库）'));
  wrap.appendChild(sec8);

  // 用 .scroll 容器包起来，这样设置页内容能滚动
  const scroll = el('div', { class: 'scroll' });
  scroll.appendChild(wrap);
  root.appendChild(scroll);

  // ============ 数据救援函数 ============

  /** 诊断数据库结构（只读，不修改任何数据） */
  async function diagnoseDB() {
    const lines = [];
    try {
      const dbs = await DB.listDatabases();
      lines.push('【浏览器中的数据库】');
      if (!dbs.length) lines.push('  (无)');
      dbs.forEach(d => {
        lines.push(`  ${d.name}  v${d.version}  stores: ${d.stores.length ? d.stores.join(', ') : '(无)'}`);
      });
    } catch (e) {
      lines.push('列出数据库失败: ' + e.message);
    }

    lines.push('');
    try {
      const db = await DB.openRaw();
      lines.push('【直接打开 ledgerly 成功】');
      lines.push('  version: ' + db.version);
      const stores = Array.from(db.objectStoreNames);
      lines.push('  stores: ' + (stores.length ? stores.join(', ') : '(无)'));
      if (stores.includes('expenses')) {
        const cnt = await new Promise((res) => {
          const req = db.transaction('expenses', 'readonly').objectStore('expenses').count();
          req.onsuccess = () => res(req.result);
          req.onerror = () => res('?');
        });
        lines.push('  expenses 记录数: ' + cnt);
      }
      db.close();
    } catch (e) {
      lines.push('【直接打开失败】' + e.message);
    }

    lines.push('');
    try {
      const all = await DB.getAll();
      const total = all.reduce((s, r) => s + Number(r.amount), 0);
      lines.push('【App 正常读取】' + all.length + ' 条，合计 ¥' + total.toFixed(2));
    } catch (e) {
      lines.push('【App 读取失败】' + e.message);
    }

    alert(lines.join('\n'));
  }

  /** 原始数据导出：绕过 db.transaction，最大限度抢救数据 */
  async function rescueExport() {
    try {
      const res = await DB.readRawAll();
      if (!res.ok) {
        showToast('无法读取：' + res.reason);
        return;
      }
      if (!res.records.length) {
        showToast('没有数据可导出');
        return;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      exportCSV(res.records, [
        { key: 'timestamp', label: '消费时间', format: (v) => new Date(v).toLocaleString('zh-CN') },
        { key: 'category', label: '类别' },
        { key: 'description', label: '描述' },
        { key: 'amount', label: '金额(元)' },
        { key: 'rawInput', label: '原始输入' }
      ], 'ledgerly_rescue_' + stamp + '.csv');
    } catch (e) {
      showToast('导出失败：' + e.message);
    }
  }

  /** 强制修复：删除数据库并重建（会清空数据，需用户明确确认） */
  async function forceRepair() {
    if (!confirm('⚠️ 强制修复会删除当前数据库，所有本地记录将丢失。\n\n请先点「💾 原始数据导出」备份！\n\n确定要继续吗？')) return;
    if (!confirm('再次确认：真的要清空所有数据吗？')) return;
    try {
      await DB.forceDeleteDB();
      showToast('数据库已重置，刷新页面即可');
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      showToast('重置失败：' + e.message);
    }
  }

  // CSV 导入 input 绑定
  const csvInput = document.getElementById('csv-import-input-settings');  if (csvInput) {
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