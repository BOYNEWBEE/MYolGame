// 背景图的 IndexedDB 存储。
// 为什么不用 localStorage：localStorage 总容量通常只有 5MB，而背景图要转成
// dataURL（体积 ×1.33），10MB 的图会变成约 13MB，必然存不下。
// IndexedDB 容量大得多（通常几百 MB），适合放大图。

const DB_NAME = 'myol-store';
const DB_VERSION = 1;
const STORE = 'assets';
const KEY = 'backdrop';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 读背景图 dataURL；没有或读失败返回 null。 */
export async function loadBackdropAsset(): Promise<string | null> {
  try {
    const db = await openDb();
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

/** 写入背景图 dataURL（覆盖旧的）。失败时抛出，由调用方提示用户。 */
export async function saveBackdropAsset(dataUrl: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(dataUrl, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** 删除已保存的背景图。 */
export async function clearBackdropAsset(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // 删除失败不影响使用
  }
}
