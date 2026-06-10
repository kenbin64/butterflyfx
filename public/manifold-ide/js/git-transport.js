// Minimal GitTransport for the browser using isomorphic-git + LightningFS
// Supports creating a local repo, writing files, committing, and pushing via HTTPS (token auth).
let git, LightningFS;

export class GitTransport {
  constructor() {
    this.fs = null; // promises API
    this.dirRoot = '/repos';
    this.ready = false;
  }

  async init() {
    if (this.ready) return;
    // dynamic import from CDN
    try {
      const modLF = await import('https://unpkg.com/@isomorphic-git/lightning-fs?module');
      LightningFS = modLF.default || modLF.LightningFS || modLF;
      const modGit = await import('https://unpkg.com/isomorphic-git@1.20.0?module');
      git = modGit.default || modGit;
    } catch (e) {
      throw new Error('Failed to load git libs: ' + e.message);
    }
    const lfs = new LightningFS('manifold-git');
    this.fs = lfs.promises;
    // ensure root
    try { await this.fs.mkdir(this.dirRoot); } catch (e) { /* ignore exists */ }
    this.ready = true;
  }

  repoPath(name) { return `${this.dirRoot}/${name}`; }

  async initRepo(name) {
    await this.init();
    const dir = this.repoPath(name);
    try { await this.fs.mkdir(dir); } catch (e) { /* ignore */ }
    await git.init({ fs: this.fs, dir });
    return dir;
  }

  async writeFile(name, path, content) {
    await this.init();
    const dir = this.repoPath(name);
    const full = dir + '/' + path;
    const parts = full.split('/').slice(0, -1);
    // ensure directories
    let p = '';
    for (const part of parts.slice(1)) { // skip leading '' from absolute
      p += '/' + part;
      try { await this.fs.mkdir(p); } catch (e) { }
    }
    await this.fs.writeFile(full, content);
  }

  async commit(name, message, author = { name: 'Owner', email: 'owner@local' }) {
    await this.init();
    const dir = this.repoPath(name);
    // add all files under dir
    const files = await this._listFiles(dir);
    for (const f of files) {
      const rel = f.substring(dir.length + 1);
      await git.add({ fs: this.fs, dir, filepath: rel });
    }
    const sha = await git.commit({ fs: this.fs, dir, message, author });
    return sha;
  }

  async setRemote(name, remoteName, url) {
    await this.init();
    const dir = this.repoPath(name);
    await git.addRemote({ fs: this.fs, dir, remote: remoteName, url, force: true });
  }

  async push(name, remote = 'origin', ref = 'main', token = '') {
    await this.init();
    const dir = this.repoPath(name);
    const onAuth = token ? { username: token } : undefined;
    const result = await git.push({ fs: this.fs, http: git.HttpClient ?? undefined, dir, remote, ref, onAuth: () => onAuth });
    return result;
  }

  async _listFiles(dir) {
    const out = [];
    async function walk(p) {
      let entries = [];
      try { entries = await this.fs.readdir(p); } catch (e) { return; }
      for (const e of entries) {
        const full = p + '/' + e;
        try {
          const st = await this.fs.stat(full);
          if (st.type === 'file' || st.isFile) out.push(full);
          else if (st.type === 'directory' || st.isDirectory) await walk.call(this, full);
        } catch (err) { }
      }
    }
    await walk.call(this, dir);
    return out;
  }
}

export default GitTransport;
