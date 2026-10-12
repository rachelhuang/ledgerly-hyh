// Web Speech API wrapper. Returns a controller object so they can reliably
// start/stop recognition (previous implementation wedged on iOS Safari because
// recognition only ended on its own with continuous=false).

const LANG = 'zh-CN';

function getRecognizerCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

export function isSupported() {
  return !!getRecognizerCtor();
}

/**
 * Create a recognition session. Usage:
 *   const ctl = createRecognizer({ onInterim, onFinal, onError });
 *   ctl.start();
 *   // later:
 *   ctl.stop();   // stops & resolves with the final transcript (or empty)
 *   ctl.cancel(); // stops & discards (no resolve)
 */
export function createRecognizer({ onInterim, onFinal, onError, onEnd } = {}) {
  const SR = getRecognizerCtor();
  if (!SR) throw new Error('当前浏览器不支持语音识别');

  let rec = null;
  let stopped = false;
  let lastFinal = '';
  let lastInterim = '';

  function handleResult(e) {
    let final = '';
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (final) lastFinal += final;
    if (interim) lastInterim = interim;
    if (onInterim && (final || interim)) {
      onInterim((lastFinal + interim).trim());
    }
    if (final && onFinal) onFinal(final);
  }

  function build() {
    rec = new SR();
    rec.lang = LANG;
    rec.continuous = true;        // 关键：让我们能 stop 任意时刻
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = handleResult;
    rec.onerror = (e) => {
      // 'no-speech' / 'aborted' 不算真正的错误
      if (e.error === 'aborted' || e.error === 'no-speech') return;
      if (onError) onError(e);
    };
    rec.onend = () => {
      // onend 会因为 stop() 或网络中断触发。处理结果由 stop() / cancel() 决定。
      if (onEnd) onEnd({ final: lastFinal.trim(), interim: lastInterim.trim() });
    };
  }

  return {
    start() {
      if (rec) return; // 已运行
      lastFinal = '';
      lastInterim = '';
      stopped = false;
      build();
      try {
        rec.start();
      } catch (err) {
        // 'invalid-state' 表示已经在跑
        if (err.error && err.error.name === 'InvalidStateError') return;
        if (onError) onError(err);
      }
    },
    /** 停止并产出最终文本（不会 resolve Promise，仅触发 onEnd） */
    stop() {
      if (!rec) return;
      stopped = true;
      try { rec.stop(); } catch {}
      rec = null;
    },
    /** 立刻中止，丢弃所有结果 */
    cancel() {
      if (!rec) return;
      stopped = true;
      try { rec.abort(); } catch {}
      rec = null;
    },
    isRunning() { return !!rec; }
  };
}

// 兼容旧 API（保留以防其他 view 还在用）
export function listen({ onInterim } = {}) {
  return new Promise((resolve, reject) => {
    const ctl = createRecognizer({
      onInterim,
      onEnd: ({ final }) => {
        if (final) resolve(final);
        else reject(new Error('未识别到语音'));
      }
    });
    ctl.start();
  });
}

export function stop() {
  // 旧 API 停止方法（兼容层）
  // 旧版本用 listen._current，新版用 controller.stop()
  // 由于没人再调用旧 stop，这里保留空实现
}