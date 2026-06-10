// Simple Markdown indexer: scans a FolderTransport-registered FS via the
// tool registry and stores markdown files in IndexedDB under 'docs'.
const DB = 'manifold-docs-db';
const DBV = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, DBV);
    r.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('docs')) {
        const st = db.createObjectStore('docs', { keyPath: 'path' });
        st.createIndex('title', 'title', { unique: false });
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function putDoc(doc) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction('docs', 'readwrite');
    const st = tx.objectStore('docs');
    const r = st.put(doc);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

export async function ingestAll(reg, onProgress = null) {
  if (!reg) throw new Error('tool registry required');
  const docs = [];
  async function walk(dir) {
    const r = await reg.call('fs_list', { path: dir });
    const entries = r.entries || [];
    for (const e of entries) {
      const child = (dir ? dir + '/' : '') + e.name;
      if (e.kind === 'directory') {
        await walk(child);
      } else if (e.kind === 'file') {
        if (child.toLowerCase().endsWith('.md') || child.toLowerCase().endsWith('.markdown')) {
          try {
            const f = await reg.call('fs_read', { path: child });
            const content = f.content || '';
            const title = (content.split('\n').find(l => l.trim().startsWith('#')) || '').replace(/^#+\s*/, '') || child.split('/').pop();
            const doc = { path: child, title, content, size: f.size || content.length, at: Date.now() };
            await putDoc(doc);
            docs.push(doc);
            if (onProgress) onProgress(doc);
          } catch (e) {
            console.warn('ingest failed for', child, e);
          }
        }
      }
    }
  }
  await walk('');
  return docs;
}

export async function listDocs() {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction('docs', 'readonly');
    const st = tx.objectStore('docs');
    const r = st.getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}


export default { ingestAll, listDocs };
