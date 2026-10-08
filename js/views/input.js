import * as DB from '../db.js';
import { Settings } from '../settings.js';
import { extractExpenseFromText, extractExpenseFromImage } from '../llm.js';
import { isSupported as speechSupported, listen as speechListen, stop as speechStop } from '../speech.js';
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
  const cfg = Settings.config;
  if (!Settings.isConfigured) throw new Error('请先在「设置」中填写 Base URL / API Key / Model');
  const extracted = await extractExpenseFromText(text);
  return await saveExtracted(extracted, text);
}

async function submitImage(file) {
  const cfg = Settings.config;
  if (!Settings.isConfigured) throw new Error('请先在「设置」中填写 Base URL / API Key / Model');
  const base64 = await fileToBase64(file);
  const extracted = await extractExpenseFromImage(base64);
  return await saveExtracted(extracted, '[图片]');
}

async function handleVoice() {
  if (!speechSupported()) {
    showToast('当前浏览器不支持语音识别');
    return;
  }
  showVoiceSheet({
    onCancel: () => speechStop(),
    onConfirm: async () => {
      try {
        showToast('正在识别语音…', 5000);
        const text = await speechListen();
        if (text) {
          // Fill into textbox and let user submit
          showToast('已识别：' + text + '（请在文本框确认后点保存）', 4000);
          const ta = document.getElementById('text-input');
          if (ta) ta.value = text;
        }
      } catch (e) {
        showToast(e.message || '识别失败');
      }
    }
  });
}

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

function showVoiceSheet({ onCancel, onConfirm }) {
  const overlay = el('div', { class: 'sheet-overlay' });
  const sheet = el('div', { class: 'sheet' });
  const title = el('h3', {}, '按住 ✓ 开始 / 结束');
  const circle = el('div', { class: 'voice-circle' }, '🎙');
  const time = el('div', { class: 'voice-time' }, '00:00');
  const hint = el('div', { class: 'muted', style: 'margin-bottom:12px;' }, '点击 ✓ 录音，再次点击 ✓ 结束识别');
  const btnRow = el('div', { class: 'voice-buttons' });
  const cancelBtn = el('button', { class: 'voice-btn cancel' }, '✕');
  const confirmBtn = el('button', { class: 'voice-btn' }, '✓');
  btnRow.append(cancelBtn, confirmBtn);
  sheet.append(title, circle, hint, time, btnRow);
  overlay.append(sheet);
  document.body.append(overlay);

  let recording = false;
  let timer = null;
  let startedAt = 0;
  let lastText = '';

  const tick = () => {
    const sec = Math.floor((Date.now() - startedAt) / 1000);
    time.textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  };

  const startRec = async () => {
    if (recording) return;
    try {
      await speechListen({
        onInterim: (t) => { lastText = t; }
      });
      // If we get here it means final was returned
    } catch (e) {
      // ignored; we use last interim text
    }
  };

  cancelBtn.onclick = async () => {
    if (timer) { clearInterval(timer); timer = null; }
    speechStop();
    onCancel && onCancel();
    overlay.remove();
  };

  confirmBtn.onclick = async () => {
    if (!recording) {
      // start
      recording = true;
      startedAt = Date.now();
      circle.classList.add('recording');
      timer = setInterval(tick, 200);
      // async listen; resolve with text via onConfirm
      onConfirm && onConfirm();
      // we don't await; let onConfirm trigger the recognition
    } else {
      // stop
      recording = false;
      circle.classList.remove('recording');
      if (timer) { clearInterval(timer); timer = null; }
      speechStop();
      // close immediately; recognition result toast will appear via onConfirm
      overlay.remove();
    }
  };
}

export function renderInput() {
  const root = document.getElementById('view');
  root.innerHTML = '';

  const wrap = el('div', { style: 'padding: 16px;' });

  // Saved card
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
        onclick: async () => {
          await DB.remove(lastSaved.id);
          lastSaved = null;
          renderInput();
        }
      }, '🗑')
    ));
  }

  // Input section
  wrap.appendChild(el('h2', {}, '自然语言输入'));
  wrap.appendChild(el('div', { class: 'muted', style: 'margin-bottom: 6px;' }, '直接说一句话，或用下方「语音 / 相机 / 相册」按钮提交凭证'));
  const ta = el('textarea', { id: 'text-input', class: 'text-area', placeholder: '在这里输入...' });
  wrap.appendChild(ta);

  // Examples
  const expWrap = el('div', { style: 'margin-top: 12px;' });
  expWrap.appendChild(el('div', { class: 'muted', style: 'margin-bottom: 4px;' }, '试试这些'));
  const expRow = el('div', { class: 'examples' });
  for (const e of EXAMPLES) {
    const chip = el('button', { class: 'chip', onclick: () => { ta.value = e; ta.focus(); } }, e);
    expRow.appendChild(chip);
  }
  expWrap.appendChild(expRow);
  wrap.appendChild(expWrap);

  // Quick actions
  wrap.appendChild(el('h2', { style: 'margin-top: 16px;' }, '快速记录'));
  const actionsRow = el('div', { class: 'actions-row' });
  const voiceBtn = el('button', { class: 'btn-action pink', onclick: handleVoice },
    el('div', { class: 'ico' }, '🎙'),
    el('div', {}, '语音')
  );
  const cameraInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
  const cameraBtn = el('button', { class: 'btn-action blue', onclick: () => cameraInput.click() },
    el('div', { class: 'ico' }, '📷'),
    el('div', {}, '相机')
  );
  const galleryInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  const galleryBtn = el('button', { class: 'btn-action green', onclick: () => galleryInput.click() },
    el('div', { class: 'ico' }, '🖼'),
    el('div', {}, '相册')
  );
  cameraInput.onchange = () => { if (cameraInput.files[0]) handleImageFile(cameraInput.files[0]); };
  galleryInput.onchange = () => { if (galleryInput.files[0]) handleImageFile(galleryInput.files[0]); };
  actionsRow.append(voiceBtn, cameraBtn, galleryBtn);
  wrap.appendChild(actionsRow);
  wrap.appendChild(cameraInput);
  wrap.appendChild(galleryInput);

  // Error
  if (lastError) {
    wrap.appendChild(el('div', { class: 'error', style: 'margin-top: 10px;' }, lastError));
  }

  // Submit
  const submitBtn = el('button', { id: 'submit-btn', class: 'btn-primary', onclick: onSubmitText }, '保存记录');
  wrap.appendChild(submitBtn);

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

  root.appendChild(wrap);
}
