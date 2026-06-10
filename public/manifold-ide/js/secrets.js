// Simple encrypted secrets store using IndexedDB and Web Crypto
// Exports a singleton `Secrets` with create/unlock/lock/get/set/delete
const DB_NAME = 'manifold-secrets-db';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('secrets')) db.createObjectStore('secrets');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function abToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function base64ToAb(s) {
  const bin = atob(s);
  const len = bin.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

async function deriveKey(passphrase, salt) {
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, keyMat, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function getMeta(key) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction('meta', 'readonly');
    const st = tx.objectStore('meta');
    const r = st.get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function putMeta(key, val) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction('meta', 'readwrite');
    const st = tx.objectStore('meta');
    const r = st.put(val, key);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

async function putSecret(name, payload) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction('secrets', 'readwrite');
    const st = tx.objectStore('secrets');
    const r = st.put(payload, name);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

async function getSecretEntry(name) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction('secrets', 'readonly');
    const st = tx.objectStore('secrets');
    const r = st.get(name);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

let _key = null; // CryptoKey in memory when unlocked

export const Secrets = {
  async create(passphrase) {
    // create new salt and derive key
    const salt = crypto.getRandomValues(new Uint8Array(16));
    await putMeta('salt', abToBase64(salt.buffer));
    _key = await deriveKey(passphrase, salt.buffer);
    return true;
  },
  async unlock(passphrase) {
    const saltB64 = await getMeta('salt');
    if (!saltB64) throw new Error('no secret exists');
    const salt = base64ToAb(saltB64);
    _key = await deriveKey(passphrase, salt);
    // quick check: try to decrypt a reserved key '__check' if present
    const entry = await getSecretEntry('__check');
    if (entry) {
      try {
        const iv = base64ToAb(entry.iv);
        const ct = base64ToAb(entry.data);
        const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, _key, ct);
        const txt = new TextDecoder().decode(dec);
        // if JSON parseable it's ok
        JSON.parse(txt);
      } catch (e) {
        _key = null;
        throw new Error('incorrect passphrase');
      }
    }
    return true;
  },
  lock() { _key = null; },
  isUnlocked() { return !!_key; },
  async set(name, obj) {
    if (!_key) throw new Error('locked');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const txt = new TextEncoder().encode(JSON.stringify(obj));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, _key, txt);
    await putSecret(name, { iv: abToBase64(iv.buffer), data: abToBase64(ct) });
  },
  async get(name) {
    if (!_key) throw new Error('locked');
    const entry = await getSecretEntry(name);
    if (!entry) return null;
    const iv = base64ToAb(entry.iv);
    const ct = base64ToAb(entry.data);
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, _key, ct);
    const txt = new TextDecoder().decode(dec);
    return JSON.parse(txt);
  },
  async delete(name) {
    const db = await openDb();
    return new Promise((res, rej) => {
      const tx = db.transaction('secrets', 'readwrite');
      const st = tx.objectStore('secrets');
      const r = st.delete(name);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  }
  async exportBackup() {
    const db = await openDb();
    // Read meta
    const meta = {};
    await new Promise((res, rej) => {
      const tx = db.transaction('meta', 'readonly');
      const st = tx.objectStore('meta');
      const r = st.getAllKeys();
      r.onsuccess = async () => {
        const keys = r.result || [];
        for (const k of keys) {
          const v = await new Promise((res2, rej2) => {
            const r2 = st.get(k); r2.onsuccess = () => res2(r2.result); r2.onerror = () => rej2(r2.error);
          });
          meta[k] = v;
        }
        res();
      };
      r.onerror = () => rej(r.error);
    });
    // Read secrets
    const secrets = {};
    await new Promise((res, rej) => {
      const tx = db.transaction('secrets', 'readonly');
      const st = tx.objectStore('secrets');
      const r = st.getAllKeys();
      r.onsuccess = async () => {
        const keys = r.result || [];
        for (const k of keys) {
          const v = await new Promise((res2, rej2) => {
            const r2 = st.get(k); r2.onsuccess = () => res2(r2.result); r2.onerror = () => rej2(r2.error);
          });
          secrets[k] = v;
        }
        res();
      };
      r.onerror = () => rej(r.error);
    });
    return { meta, secrets };
  },
  async importBackup(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('invalid backup');
    const db = await openDb();
    await new Promise((res, rej) => {
      const tx = db.transaction(['meta', 'secrets'], 'readwrite');
      const metaSt = tx.objectStore('meta');
      const secSt = tx.objectStore('secrets');
      try {
        if (obj.meta) for (const k of Object.keys(obj.meta)) metaSt.put(obj.meta[k], k);
        if (obj.secrets) for (const k of Object.keys(obj.secrets)) secSt.put(obj.secrets[k], k);
      } catch (e) { rej(e); }
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error || new Error('transaction failed'));
    });
  },
};

export default Secrets;
