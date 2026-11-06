import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, writeFile, mkdir, realpath, readdir, stat, rename, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DEFAULT_CONFIG, MASTER_DIGEST, normalizePath, validateConfig, validateRules, parseJson } from './file-model.js';

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = new Set(['index.html', 'landing.js', 'landing.css', 'download-center.json', 'app.js', 'file-model.js', 'password-hash.js', 'aegipulse.css', 'explorer.css', 'shefiles-icon.svg', 'sw.js', 'protected-rules.json', 'explorer-config.json', 'wiki-config.json', 'ereader-config.json', 'ereader-manifest.json']);
const CONFIG_FILES = new Set(['protected-rules.json', 'explorer-config.json', 'wiki-config.json', 'ereader-config.json', 'ereader-manifest.json']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.zip': 'application/zip', '.exe': 'application/octet-stream', '.msi': 'application/octet-stream', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg' };
const hash = value => createHash('sha256').update(value).digest('hex');
const escape = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const within = (root, target) => { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
function error(status, message) { return Object.assign(new Error(message), { status }); }
function json(res, status, body, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); res.end(JSON.stringify(body)); }
function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}
async function body(req) {
  const parts = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw error(413, 'El JSON debe ser menor de 1 MB.'); parts.push(chunk); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw error(400, 'JSON no válido.'); }
}

export function createServer(options = {}) {
  const root = path.resolve(options.root || APP_ROOT);
  const configDir = path.resolve(options.configDir || process.env.SHEFILES_CONFIG_DIR || root);
  // Point at the existing release directory; never create or move release files.
  const downloads = path.resolve(options.downloads || process.env.SHEFILES_DOWNLOADS_DIR || path.join(root, 'downloads'));
  const privateDir = path.resolve(options.privateDir || process.env.SHEFILES_PRIVATE_DIR || path.join(path.dirname(root), '.SHEFiles-private'));
  if (within(root, privateDir) || within(downloads, privateDir) || within(configDir, privateDir)) throw new Error('El directorio privado debe estar fuera de las rutas públicas.');
  const masterDigest = options.masterDigest || (process.env.SHEFILES_MASTER_KEY ? hash(process.env.SHEFILES_MASTER_KEY) : MASTER_DIGEST);
  const publicOrigin = options.publicOrigin || process.env.SHEFILES_PUBLIC_ORIGIN;
  const sessions = new Map(); const attempts = new Map(); const writes = new Map();
  let config = { ...DEFAULT_CONFIG };
  const ready = readFile(path.join(configDir, 'explorer-config.json'), 'utf8').then(text => { config = validateConfig(parseJson(text)); }).catch(err => { if (err.code !== 'ENOENT') throw err; });

  async function confinedFile(relative, base) {
    const baseReal = await realpath(base); const target = await realpath(path.resolve(baseReal, relative));
    if (!within(baseReal, target)) throw error(403, 'Ruta fuera del directorio permitido.');
    const segments = path.relative(baseReal, target).split(path.sep);
    if (segments.some(segment => segment.startsWith('.'))) throw error(403, 'Archivo privado.');
    return target;
  }
  function downloadRelative(urlPath, directory = false) {
    let clean;
    try { clean = normalizePath(urlPath, config.basePath, directory); } catch { throw error(400, 'Ruta no válida.'); }
    const relative = clean.slice(config.basePath.length).split('/').map(segment => decodeURIComponent(segment)).join(path.sep);
    if (relative.split(path.sep).some(part => part.startsWith('.'))) throw error(403, 'Archivo privado.');
    return relative;
  }
  async function editable(file) {
    if (typeof file !== 'string') throw error(400, 'Ruta no válida.');
    if (CONFIG_FILES.has(file)) return confinedFile(file, configDir);
    if (!file.startsWith(config.basePath) || !file.toLowerCase().endsWith('.json')) throw error(403, 'Solo se pueden editar configuraciones y archivos JSON de descargas.');
    return confinedFile(downloadRelative(file), downloads);
  }
  function sameOrigin(req) {
    const expected = publicOrigin || 'http://' + req.headers.host;
    if (req.headers.origin && req.headers.origin !== expected) throw error(403, 'Origen no permitido.');
    if (req.headers['sec-fetch-site'] === 'cross-site') throw error(403, 'Origen no permitido.');
  }
  function auth(req, mutation = false) {
    if (mutation) sameOrigin(req);
    const token = /(?:^|;\s*)shefiles_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    const session = sessions.get(token);
    if (!session || session.expires < Date.now()) { if (token) sessions.delete(token); throw error(401, 'La sesión expiró. Ingrese la clave maestra nuevamente.'); }
    if (mutation && req.headers['x-shefiles-csrf'] !== session.csrf) throw error(403, 'Solicitud de guardado no válida.');
    return { token, session };
  }
  const cookie = (req, token, maxAge = 1800) => `shefiles_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${publicOrigin?.startsWith('https://') || req.socket.encrypted ? '; Secure' : ''}`;
  async function serialize(target, action) {
    const previous = writes.get(target) || Promise.resolve(); const current = previous.catch(() => {}).then(action); writes.set(target, current);
    try { return await current; } finally { if (writes.get(target) === current) writes.delete(target); }
  }
  async function api(req, res, url) {
    if (url.pathname === '/api/capabilities' && req.method === 'GET') return json(res, 200, { service: 'shefiles', editing: options.editing !== false });
    if (url.pathname === '/api/login' && req.method === 'POST') {
      sameOrigin(req);
      const ip = req.socket.remoteAddress; const now = Date.now();
      for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
      for (const [key, session] of sessions) if (session.expires < now) sessions.delete(key);
      let entry = attempts.get(ip); if (!entry) { entry = { count: 0, until: now + 60000 }; attempts.set(ip, entry); }
      if (entry.count >= 5) throw error(429, 'Demasiados intentos. Espere un minuto.');
      entry.count++;
      const input = await body(req);
      if (typeof input?.password !== 'string' || input.password.length > 1024) throw error(400, 'Clave no válida.');
      if (!timingSafeEqual(Buffer.from(hash(input.password), 'hex'), Buffer.from(masterDigest, 'hex'))) throw error(401, 'Clave maestra incorrecta.');
      attempts.delete(ip);
      const token = randomBytes(32).toString('hex'); const csrf = randomBytes(24).toString('hex'); sessions.set(token, { csrf, expires: now + 30 * 60000 });
      return json(res, 200, { csrf }, { 'Set-Cookie': cookie(req, token) });
    }
    if (url.pathname === '/api/session' && req.method === 'GET') return json(res, 200, { csrf: auth(req).session.csrf });
    if (url.pathname === '/api/logout' && req.method === 'POST') { const { token } = auth(req, true); sessions.delete(token); return json(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) }); }
    if (options.editing === false) throw error(404, 'API de edición no disponible.');
    if (url.pathname === '/api/file' && req.method === 'GET') {
      auth(req); const target = await editable(url.searchParams.get('path'));
      const info = await stat(target); if (!info.isFile() || info.size > 1024 * 1024) throw error(413, 'El JSON debe ser menor de 1 MB.');
      const content = await readFile(target, 'utf8'); return json(res, 200, { content, revision: hash(content) });
    }
    if (url.pathname === '/api/file' && req.method === 'PUT') {
      auth(req, true); const input = await body(req); const target = await editable(input.path);
      if (typeof input.content !== 'string' || Buffer.byteLength(input.content) > 1024 * 1024) throw error(400, 'Contenido no válido o demasiado grande.');
      let data; try { data = parseJson(input.content); } catch { throw error(400, 'JSON no válido. No se guardó ningún cambio.'); }
      try { if (input.path === 'protected-rules.json') validateRules(data, config.basePath); if (input.path === 'explorer-config.json') validateConfig(data); } catch (err) { throw error(400, err.message); }
      const result = await serialize(target, async () => {
        // Recheck the resolved path and revision immediately before replacing it.
        if (await editable(input.path) !== target) throw error(409, 'La ruta cambió. Vuelva a cargar el archivo.');
        const old = await readFile(target); if (input.revision !== hash(old)) throw error(409, 'Otro proceso modificó el archivo. Conserve su borrador y vuelva a cargar antes de guardar.');
        if (input.path === 'explorer-config.json') {
          const existingRules = parseJson(await readFile(path.join(configDir, 'protected-rules.json'), 'utf8'));
          try { validateRules(existingRules, data.basePath || DEFAULT_CONFIG.basePath); }
          catch { throw error(400, 'La nueva basePath dejaría reglas de visibilidad fuera de su ruta. Actualice las reglas antes de cambiarla.'); }
        }
        await mkdir(privateDir, { recursive: true, mode: 0o700 });
        const backup = `${Date.now()}-${randomBytes(6).toString('hex')}-${path.basename(target)}.bak`;
        await writeFile(path.join(privateDir, backup), old, { flag: 'wx', mode: 0o600 });
        const temp = path.join(path.dirname(target), '.shefiles-' + randomBytes(12).toString('hex') + '.tmp');
        try { const info = await stat(target); await writeFile(temp, input.content, { flag: 'wx', mode: info.mode }); await rename(temp, target); }
        finally { await unlink(temp).catch(() => {}); }
        if (input.path === 'explorer-config.json') config = validateConfig(data);
        return { ok: true, revision: hash(input.content), backup };
      });
      return json(res, 200, result);
    }
    throw error(404, 'API no disponible.');
  }
  async function serveFile(req, res, target, download = false, attachment = false) {
    const info = await stat(target); if (!info.isFile()) throw error(404, 'Archivo no disponible.');
    const etag = `"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
    const headers = { 'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
    if (download) {
      headers.ETag = etag;
      headers['Last-Modified'] = info.mtime.toUTCString();
    }
    if (attachment || (download && !['.json', '.txt', '.md', '.png', '.jpg', '.pdf'].includes(path.extname(target).toLowerCase()))) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(target))}`;
    if (download && req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    let start = 0, end = info.size - 1, status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (match && (match[1] || match[2])) {
        if (match[1]) { start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), end); }
        else start = Math.max(0, info.size - Number(match[2]));
        if (start > end || start >= info.size || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end(); }
        status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
      }
    }
    headers['Content-Length'] = Math.max(0, end - start + 1); res.writeHead(status, headers);
    if (req.method === 'HEAD' || info.size === 0) return res.end();
    const stream = createReadStream(target, { start, end }); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
  }
  return http.createServer(async (req, res) => {
    try {
      await ready;
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (!['GET', 'HEAD'].includes(req.method)) throw error(405, 'Método no permitido.');
      if (url.pathname === '/wiki.html' || url.pathname === '/ereader.html') return redirect(res, '/' + url.search);
      if (['/', '/index.html', '/explorer.html'].includes(url.pathname) && url.searchParams.has('download')) {
        const file = url.searchParams.get('download');
        downloadRelative(file);
        return redirect(res, normalizePath(file, config.basePath, false) + '?attachment=1');
      }
      if (url.pathname === '/explorer.html') {
        try { auth(req); }
        catch (err) {
          if (err.status !== 401) throw err;
          const next = new URLSearchParams({ login: '1' });
          if (url.searchParams.has('open')) next.set('open', url.searchParams.get('open'));
          return redirect(res, '/?' + next);
        }
        return await serveFile(req, res, await confinedFile('explorer-view.html', root));
      }
      if (url.pathname === config.basePath.slice(0, -1)) return redirect(res, config.basePath, 301);
      if (url.pathname.startsWith(config.basePath)) {
        // Validate the original request path before URL erases traversal segments.
        const rawPath = req.url.split('?')[0]; const directory = url.pathname.endsWith('/');
        const relative = downloadRelative(rawPath, directory); const target = await confinedFile(relative, downloads);
        const info = await stat(target);
        if (info.isDirectory()) {
          auth(req);
          if (!directory) return redirect(res, url.pathname + '/', 301);
          const entries = await readdir(target, { withFileTypes: true });
          const links = entries.filter(e => !e.name.startsWith('.') && !e.isSymbolicLink()).map(e => `<li><a href="${encodeURIComponent(e.name)}${e.isDirectory() ? '/' : ''}">${escape(e.name)}${e.isDirectory() ? '/' : ''}</a></li>`).join('');
          const html = `<!doctype html><html lang="es" data-shefiles-listing><meta charset="utf-8"><title>Index of ${escape(url.pathname)}</title><h1>Index of ${escape(url.pathname)}</h1><ul>${links}</ul></html>`;
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); return res.end(req.method === 'HEAD' ? undefined : html);
        }
        return await serveFile(req, res, target, true, url.searchParams.get('attachment') === '1');
      }
      const asset = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!ASSETS.has(asset)) throw error(404, 'Archivo no disponible.');
      const configAsset = CONFIG_FILES.has(asset);
      if (configAsset) auth(req);
      return await serveFile(req, res, await confinedFile(asset, configAsset ? configDir : root));
    } catch (err) {
      const status = err.status || (err.code === 'ENOENT' ? 404 : 500);
      if (!res.headersSent) json(res, status, { error: status === 500 ? 'No se pudo completar la operación.' : err.message });
      else res.destroy();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const envFile = process.env.SHEFILES_ENV_FILE;
  try { process.loadEnvFile(envFile || path.join(APP_ROOT, '.env')); }
  catch (err) { if (envFile || err.code !== 'ENOENT') throw err; }
  if ((envFile || process.env.SHEFILES_MASTER_KEY !== undefined) && !process.env.SHEFILES_MASTER_KEY?.trim()) {
    throw new Error('Configura SHEFILES_MASTER_KEY en el archivo privado.');
  }
  const host = process.env.SHEFILES_HOST || '127.0.0.1'; const port = Number(process.env.PORT || 3000);
  const server = createServer(); server.on('error', err => { console.error('SHEFiles:', err.message); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`SHEFiles: http://${host}:${port} · /downloads/ points to the configured release directory.`));
}
