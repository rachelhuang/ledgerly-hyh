import * as DB from '../db.js';
import { Settings } from '../settings.js';
import { extractExpenseFromText, extractExpenseFromImage } from '../llm.js';
import { isSupported as speechSupported, createRecognizer } from '../speech.js';
import { el, fmtDate, fmtMoney, showToast } from '../util.js';

const EXAMPLES = [
  '今天中午和同事吃火锅花了 128 元',
  '昨天打车到机场 60 元',
  '上周五超市采购日用品 235 元',
  '今晚和朋友看演唱会 380 元'
];

let lastSaved = null;
let lastError = null;
let isSubmitting = false;

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function saveExtracted(extracted, raw) {
  if (!(extracted.amount > 0)) throw new Error('未能识别到消费信息（金额为 0），未写入记录。');
  const cat = (extracted.category || '').trim();
  if (!cat) throw new Error('未能识别到消费信息（类别为空），未写入记录。');
  const desc = (extracted.description || '').trim() || cat;
  const ts = parseDate(extracted.timestamp) || new Date();

  const record = {
    id: crypto.randomUUID(),
    timestamp: ts.toISOString(),
    category: cat,
    amount: Number(extracted.amount),
    description: desc,
    rawInput: raw,
    createdAt: new Date().toISOString()
  };
  await DB.add(record);
  return record;
}

async function submitText(text) {
  if (!Settings.isConfigured) throw new Error('请先在「设置」中填写 Base URL / API Key / Model');
  const extracted = await LLM.extractExpenseFromText(text);
  return await saveExtracted(extracted, text);
}

async function submitImage(file) {
  if (!Settings.isConfigured) throw new Error('请先在「设置」中填写 Base URL / API Key / Model');
  const base64 = await fileToBase64(file);
  const extracted = await LLM.extractExpenseFromImage(base64);
  return await saveExtracted(extracted, '[图片]');
}

// 删除一条记录（首页"已记录"卡片用）
async function deleteRecord(r) {
  await DB.remove(r.id);
  if (lastSaved && lastSaved.id === r.id) {
    lastSaved = null;
  }
}

// ========== 语音 sheet（重写版） ==========
function showVoiceSheet({ onSubmit, onCancel }) {
  if (!speechSupported()) {
    showToast('当前浏览器不支持语音识别');
    return;
  }

  const overlay = el('div', { class: 'sheet-overlay' });
  const sheet = el('div', { class: 'sheet' });
  const title = el('h3', {}, '语音记账');

  const circle = el('div', { class: 'voice-circle' }, '🎙');
  const time = el('div', { class: 'voice-time' }, '00:00');
  const transcriptBox = el('div', {
    class: 'voice-transcript',
    style: 'min-height:48px; max-height:120px; overflow:auto; padding:10px; border-radius:8px; background:#f5f5f7; font-size:14px; margin:8px 0 16px; color:#333; white-space:pre-wrap;'
  }, '点击麦克风开始说话');
  const hint = el('div', { class: 'muted', style: 'font-size:11px; margin-bottom:8px;' }, '提示：可中途点 ✓ 完成，会自动把文字填到文本框');

  const btnRow = el('div', { class: 'voice-buttons' });
  const cancelBtn = el('button', { class: 'voice-btn cancel' }, '✕');
  const toggleBtn = el('button', { class: 'voice-btn', id: 'voice-toggle' }, '🎙');
  const confirmBtn = el('button', { class: 'voice-btn', id: 'voice-confirm' }, '✓');
  btnRow.append(cancelBtn, toggleBtn, confirmBtn);

  sheet.append(title, circle, hint, transcriptBox, time, btnRow);
  overlay.append(sheet);
  document.body.append(overlay);

  let startedAt = 0;
  let timer = null;
  let lastTranscript = '';
  const ctl = createRecognizer({
    onInterim: (text) => {
      lastTranscript = text;
      transcriptBox.textContent = text || '点击麦克风开始说话';
    },
    onError: (e) => {
      showToast('语音识别错误：' + (e.error || e.message || 'unknown'));
    },
    onEnd: ({ final }) => {
      // 只要拿到 final 就视为成功，可点 ✓ 提交
      if (final) lastTranscript = final;
      transcriptBox.textContent = lastTranscript || '（未识别到）';
    }
  });

  function tick() {
    const sec = Math.floor((Date.now() - startedAt) / 1000);
    time.textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  }

  function start() {
    if (ctl.isRunning()) return;
    ctl.start();
    startedAt = Date.now();
    circle.classList.add('recording');
    transcriptBox.textContent = '正在听...';
    timer = setInterval(tick, 200);
  }

  function stop() {
    if (!ctl.isRunning()) return;
    ctl.stop();
    circle.classList.remove('recording');
    if (timer) { clearInterval(timer); timer = null; }
  }

  function cleanup() {
    if (ctl.isRunning()) ctl.cancel();
    if (timer) clearInterval(timer);
    overlay.remove();
  }

  toggleBtn.onclick = () => {
    if (ctl.isRunning()) stop();
    else start();
  };

  confirmBtn.onclick = () => {
    // 拿到当前累积文本，关闭弹窗，提交到文本框
    stop();
    cleanup();
    onSubmit(lastTranscript || '');
  };

  cancelBtn.onclick = () => {
    cleanup();
    onCancel();
  };
}

// ========== 图片选择处理 ==========
async function handleImageFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) {
    showToast('请选择图片文件');
    return;
  }
  try {
    setBusy(true);
    const record = await submitImage(file);
    lastSaved = record;
    lastError = null;
    showToast('已保存');
    renderInput();
  } catch (e) {
    lastError = e.message;
    lastSaved = null;
    renderInput();
  } finally {
    setBusy(false);
  }
}

function setBusy(v) {
  isSubmitting = v;
  const btn = document.getElementById('submit-btn');
  if (btn) {
    btn.disabled = v;
    btn.textContent = v ? '正在解析...' : '保存记录';
  }
}

// ========== 渲染入口 ==========
export function renderInput() {
  const root = document.getElementById('view');
  root.innerHTML = '';

  const wrap = el('div', { style: 'padding: 16px;' });

  // 已记录卡片（含删除按钮）
  if (lastSaved) {
    wrap.appendChild(el('div', { class: 'saved-card' },
      el('div', { class: 'icon' }, '✅'),
      el('div', { class: 'body' },
        el('h3', {}, `${lastSaved.category} · ¥${fmtMoney(lastSaved.amount)}`),
        el('div', { class: 'desc' }, lastSaved.description),
        el('div', { class: 'time' }, fmtDate(lastSaved.timestamp))
      ),
      el('button', {
        class: 'delete-btn',
        title: '删除这条记录',
        onclick: async () => {
          if (!confirm('确定删除这条记录？')) return;
          try {
            await deleteRecord(lastSaved);
            showToast('已删除');
            renderInput();
          } catch (e) {
            showToast('删除失败：' + e.message);
          }
        }
      }, '🗑')
    ));
  }

  // 输入区
  wrap.appendChild(el('h2', {}, '自然语言输入'));
  wrap.appendChild(el('div', { class: 'muted', style: 'margin-bottom: 6px;' }, '直接说一句话，或用下方「语音 / 相机 / 相册」按钮提交凭证'));
  const ta = el('textarea', { id: 'text-input', class: 'text-area', placeholder: '在这里输入...' });
  wrap.appendChild(ta);

  // 示例
  const expWrap = el('div', { style: 'margin-top: 12px;' });
  expWrap.appendChild(el('div', { class: 'muted', style: 'margin-bottom: 4px;' }, '试试这些'));
  const expRow = el('div', { class: 'examples' });
  for (const e of EXAMPLES) {
    expRow.appendChild(el('button', {
      class: 'chip',
      onclick: () => { ta.value = e; ta.focus(); }
    }, e));
  }
  expWrap.appendChild(expRow);
  wrap.appendChild(expWrap);

  // 快捷按钮
  wrap.appendChild(el('h2', { style: 'margin-top: 16px;' }, '快速记录'));
  const actionsRow = el('div', { class: 'actions-row' });
  const cameraInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
  const galleryInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  cameraInput.onchange = () => { if (cameraInput.files[0]) handleImageFile(cameraInput.files[0]); };
  galleryInput.onchange = () => { if (galleryInput.files[0]) handleImageFile(galleryInput.files[0]); };

  actionsRow.appendChild(el('button', {
    class: 'btn-action pink',
    onclick: () => showVoiceSheet({
      onSubmit: (text) => {
        if (text) {
          ta.value = text;
          showToast('已识别：' + text);
        } else {
          showToast('未识别到语音');
        }
      },
      onCancel: () => {}
    })
  }, el('div', { class: 'ico' }, '🎙'), el('div', {}, '语音')));
  actionsRow.appendChild(el('button', {
    class: 'btn-action blue',
    onclick: () => cameraInput.click()
  }, el('div', { class: 'ico' }, '📷'), el('div', {}, '相机')));
  actionsRow.appendChild(el('button', {
    class: 'btn-action green',
    onclick: () => galleryInput.click()
  }, el('div', { class: 'ico' }, '🖼'), el('div', {}, '相册')));
  wrap.appendChild(actionsRow);
  wrap.appendChild(cameraInput);
  wrap.appendChild(galleryInput);

  // 错误提示
  if (lastError) {
    wrap.appendChild(el('div', { class: 'error', style: 'margin-top: 10px;' }, lastError));
  }

  // 保存按钮
  const submitBtn = el('button', {
    id: 'submit-btn',
    class: 'btn-primary',
    onclick: onSubmitText
  }, '保存记录');
  wrap.appendChild(submitBtn);

  root.appendChild(wrap);

  async function onSubmitText() {
    const text = (ta.value || '').trim();
    if (!text) return;
    try {
      setBusy(true);
      const rec = await submitText(text);
      lastSaved = rec;
      lastError = null;
      ta.value = '';
      renderInput();
    } catch (e) {
      lastError = e.message || String(e);
      renderInput();
    } finally {
      setBusy(false);
    }
  }
}