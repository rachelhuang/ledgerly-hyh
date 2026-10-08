// Web Speech API wrapper (browser equivalent of iOS SpeechRecognizer).
// Uses webkitSpeechRecognition / SpeechRecognition with continuous=false.

const LANG = 'zh-CN';

function getRecognizer() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) throw new Error('当前浏览器不支持语音识别');
  return SR;
}

export function isSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Listen and return final transcript text. Resolves on final result, rejects on error.
 */
export function listen({ onInterim } = {}) {
  return new Promise((resolve, reject) => {
    const SR = getRecognizer();
    const rec = new SR();
    rec.lang = LANG;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let resolved = false;
    rec.onresult = (e) => {
      let final = '';
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim && onInterim) onInterim(interim);
      if (final && !resolved) {
        resolved = true;
        resolve(final.trim());
        try { rec.stop(); } catch {}
      }
    };
    rec.onerror = (e) => {
      if (!resolved) {
        resolved = true;
        reject(new Error('语音识别错误：' + (e.error || 'unknown')));
      }
    };
    rec.onend = () => {
      if (!resolved) {
        // No final result obtained
        resolved = true;
        reject(new Error('未识别到语音'));
      }
    };

    try {
      rec.start();
    } catch (err) {
      reject(err);
    }

    // Save reference so caller can stop
    listen._current = rec;
  });
}

export function stop() {
  const rec = listen._current;
  if (rec) {
    try { rec.stop(); } catch {}
    listen._current = null;
  }
}
