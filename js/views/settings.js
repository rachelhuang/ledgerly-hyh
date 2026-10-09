import { Settings } from '../settings.js';
import { testConnection } from '../llm.js';
import { el } from '../util.js';

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

export function renderSettings() {
  const root = document.getElementById('view');
  root.innerHTML = '';

  const wrap = el('div', { style: 'padding-top: 8px;' });

  // Status
  const statusOk = checkConfigured();
  wrap.appendChild(el('div', { class: 'section' },
    el('div', { class: 'field' },
      el('div', { style: 'display:flex; align-items:center; gap:6px;' },
        el('span', { style: `color:${statusOk ? '#2f9e44' : '#f08c00'}; font-size: 16px;` }, statusOk ? '✅' : '⚠'),
        el('span', { style: 'font-weight: 500;' }, statusOk ? '已配置' : '未配置')
      )
    )
  ));

  // Config
  const sec1 = el('div', { class: 'section' });
  sec1.appendChild(el('h3', {}, '大模型配置（OpenAI 兼容）'));

  const f1 = el('div', { class: 'field' });
  f1.appendChild(el('label', {}, 'Base URL'));
  const i1 = el('input', {
    type: 'url', value: formValues.baseURL, autocomplete: 'off',
    oninput: (e) => { formValues.baseURL = e.target.value.trim(); updateStatus(); }
  });
  f1.appendChild(i1);
  sec1.appendChild(f1);

  const f2 = el('div', { class: 'field' });
  f2.appendChild(el('label', {}, 'API Key'));
  const i2 = el('input', {
    type: 'password', value: formValues.apiKey, autocomplete: 'off',
    oninput: (e) => { formValues.apiKey = e.target.value.trim(); updateStatus(); }
  });
  f2.appendChild(i2);
  sec1.appendChild(f2);

  const f3 = el('div', { class: 'field' });
  f3.appendChild(el('label', {}, 'Model'));
  const i3 = el('input', {
    type: 'text', value: formValues.model, autocomplete: 'off',
    oninput: (e) => { formValues.model = e.target.value.trim(); updateStatus(); }
  });
  f3.appendChild(i3);
  sec1.appendChild(f3);
  wrap.appendChild(sec1);

  // Test
  const sec2 = el('div', { class: 'section' });
  const testBtn = el('button', {
    class: 'btn-primary',
    onclick: runTest
  }, testing ? '测试中...' : '测试连接');
  sec2.appendChild(testBtn);
  if (lastResult) {
    sec2.appendChild(el('div', {
      class: 'footer',
      style: `color: ${lastResult.success ? '#2f9e44' : '#d6336c'}; margin-top: 8px;`
    }, lastResult.msg));
  }
  sec2.appendChild(el('div', { class: 'footer' }, '测试会向 LLM 发起一次真实请求，验证 API Key 与模型名是否可用。'));
  wrap.appendChild(sec2);

  // Examples
  const sec3 = el('div', { class: 'section' });
  sec3.appendChild(el('h3', {}, '常用 Base URL 示例'));
  const urls = [
    'OpenAI: https://api.openai.com/v1',
    'DeepSeek: https://api.deepseek.com/v1',
    'Moonshot: https://api.moonshot.cn/v1',
    '智谱 GLM: https://open.bigmodel.cn/api/paas/v4'
  ];
  for (const u of urls) {
    sec3.appendChild(el('div', { class: 'footer' }, u));
  }
  wrap.appendChild(sec3);

  // Voice note
  const sec4 = el('div', { class: 'section' });
  sec4.appendChild(el('h3', {}, '语音识别'));
  sec4.appendChild(el('div', { class: 'footer', style: 'display:flex; gap:6px; align-items:center;' },
    el('span', {}, '🎙'),
    el('span', {}, '语音通过浏览器 Web Speech API 识别为文本，再交给 LLM 抽取。需要 HTTPS 或 localhost。')
  ));
  wrap.appendChild(sec4);

  // About
  const sec5 = el('div', { class: 'section' });
  sec5.appendChild(el('h3', {}, '关于'));
  sec5.appendChild(el('div', { class: 'field' },
    el('div', {}, 'Ledgerly PWA · v1.0'),
    el('div', { class: 'footer', style: 'margin-top:4px;' }, '数据存储于浏览器 IndexedDB，可在 Safari/Chrome 安装到桌面')
  ));
  wrap.appendChild(sec5);

  root.appendChild(wrap);

  updateStatus();

  function updateStatus() {
    const ok = checkConfigured();
    testBtn.disabled = !ok || testing;
    testBtn.textContent = testing ? '测试中...' : '测试连接';
  }

  async function runTest() {
    if (!checkConfigured() || testing) return;

    // Persist to localStorage so other views can read
    Settings.baseURL = formValues.baseURL;
    Settings.apiKey = formValues.apiKey;
    Settings.model = formValues.model;

    testing = true;
    lastResult = null;
    updateStatus();
    try {
      const r = await testConnection();
      lastResult = { success: true, msg: `✅ 连接成功：${r.category} ¥${r.amount} · ${r.description}` };
    } catch (e) {
      lastResult = { success: false, msg: '❌ ' + (e.message || String(e)) };
    }
    testing = false;
    updateStatus();
    if (lastResult) {
      const footer = sec2.querySelector('.footer:last-of-type');
      // re-render only the result line
      let resultLine = sec2.querySelector('.test-result');
      if (!resultLine) {
        resultLine = el('div', { class: 'footer test-result' });
        sec2.insertBefore(resultLine, footer);
      }
      resultLine.style.color = lastResult.success ? '#2f9e44' : '#d6336c';
      resultLine.style.marginTop = '8px';
      resultLine.textContent = lastResult.msg;
    }
  }
}
