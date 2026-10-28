// IndexedDB wrapper for Ledgerly expense records.
//
// 数据安全原则：**绝不自动删除数据库**。
// 任何异常都先诊断、给出可导出的机会，只有用户明确点击「强制修复」才重建。

const DB_NAME = 'ledgerly';
// ⚠️ 不要随意提升版本号：一旦 version 变化会触发 onupgradeneeded，
// 若此时旧连接未关闭可能被 blocked，进而导致数据风险。
// 保持 1，通过 openRaw()/readRawAll() 做无损救援。
const DB_VERSION = 1;
const STORE = 'expenses';

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      const tx = req.transaction;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      } else {
        try {
          const os = tx.objectStore(STORE);
          if (!os.indexNames.contains('timestamp')) {
            os.createIndex('timestamp', 'timestamp', { unique: false });
          }
        } catch (e) {
          console.warn('索引创建失败（忽略）:', e);
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); _dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('无法打开数据库'));
    req.onblocked = () => {
      _dbPromise = null;
      reject(new Error('数据库被其他 Ledgerly 窗口占用，请关闭其他窗口后刷新'));
    };
  });
  return _dbPromise;
}

/** 打开数据库但不升级（用于诊断/救援，可读取旧版本） */
export function openRaw() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);   // 不带 version → 不触发 upgrade
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('被其他窗口阻塞'));
  });
}

/** 列出浏览器中所有数据库及其结构（诊断用） */
export async function listDatabases() {
  if (!indexedDB.databases) return [];
  try {
    const dbs = await indexedDB.databases();
    return dbs.map(d => ({
      name: d.name,
      version: d.version,
      stores: (d.objectStores || []).map(s => s.name)
    }));
  } catch (e) {
    return [];
  }
}

/** 直接从原始 store 读取（不做任何修复），用于救援导出 */
export async function readRawAll() {
  const db = await openRaw();
  try {
    if (!db.objectStoreNames.contains(STORE)) {
      return { ok: false, reason: '数据库中不存在 expenses 表', records: [] };
    }
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    const records = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    return { ok: true, reason: '', records };
  } finally {
    db.close();
  }
}

/** 删除数据库（仅在用户明确确认「强制修复」时调用） */
export function forceDeleteDB() {
  _dbPromise = null;
  return new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.deleteDatabase(DB_NAME);
    } catch (e) {
      resolve();
      return;
    }
    const done = () => resolve();
    req.onsuccess = done;
    req.onerror = done;
    req.onblocked = done;
    setTimeout(done, 2000);
  });
}

/** 拿到 object store（不做任何删除操作） */
async function getStore(mode) {
  // 最多重试 2 次：第一次正常，失败后重开连接再试
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE)) {
        throw new Error('数据库结构异常（缺少 expenses 表），请到「设置 → 数据救援」处理');
      }
      return db.transaction(STORE, mode).objectStore(STORE);
    } catch (e) {
      lastErr = e;
      // 连接可能已被 Safari 冻结关闭 → 丢弃缓存，下次重新打开
      _dbPromise = null;
      console.warn('数据库操作失败（第 ' + (attempt + 1) + ' 次），重开连接重试:', e);
      // 让出主线程，给浏览器机会恢复连接
      await new Promise(r => setTimeout(r, 120));
    }
  }
  throw lastErr || new Error('数据库操作失败');
}
function tx(mode = 'readonly') {
  return getStore(mode);
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

export async function add(record) {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.add(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

export async function put(record) {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

export async function remove(id) {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getAll() {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function clear() {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * 页面从后台恢复时重置连接。
 * Safari 在页面挂起一段时间后会冻结页面并静默关闭 IndexedDB 连接，
 * 导致后续 db.transaction() 抛 InvalidStateError。
 * 恢复时丢弃缓存的连接，下次操作会重新建立。
 */
export function resetConnection() {
  _dbPromise = null;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      resetConnection();
      console.log('页面恢复前台，重置数据库连接');
    }
  });
  // 从 BFCache 恢复（iOS Safari 常见）
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) resetConnection();
  });
  window.addEventListener('pagehide', () => resetConnection());
  // 页面卸载时主动关闭连接，避免阻塞其他标签页
  window.addEventListener('beforeunload', () => {
    if (_dbPromise) {
      _dbPromise.then(db => { try { db.close(); } catch (e) {} }).catch(() => {});
    }
  });
}
