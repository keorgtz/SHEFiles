// Shared path and configuration rules for the static explorer and optional server.
export function parseJson(text) { return JSON.parse(text.replace(/^\uFEFF/, '')); }
export const DEFAULT_CONFIG = Object.freeze({ basePath: '/downloads/', title: 'SHEFiles', subtitle: 'Versiones listas para compartir', defaultView: 'list', defaultTheme: 'system' });
export const MASTER_DIGEST = '56fdb30684f8e0a1c1fb42e47520c3d89a16f46b607e46d0a188658e8be6ce74';

export function normalizePath(value, basePath = '/downloads/', directory = true, origin = 'http://localhost') {
  if (typeof value !== 'string' || !value || /[\\\u0000-\u001f]/.test(value)) throw new Error('Ruta no válida.');
  // Reject traversal before URL normalizes dot segments. Decode exactly once.
  const raw = value.split(/[?#]/)[0];
  for (const part of raw.split('/')) {
    let decoded;
    try { decoded = decodeURIComponent(part); } catch { throw new Error('Ruta no válida.'); }
    if (decoded === '..' || decoded === '.' || /[\\/\u0000-\u001f]/.test(decoded)) throw new Error('Ruta no válida.');
  }
  const url = new URL(value, origin + basePath);
  if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || url.search || url.hash || !url.pathname.startsWith(basePath)) throw new Error('La ruta debe pertenecer al directorio de descargas.');
  let path = url.pathname;
  if (directory && !path.endsWith('/')) path += '/';
  if (!directory && path.endsWith('/')) throw new Error('Seleccione un archivo.');
  return path;
}

export function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('La configuración debe ser un objeto JSON.');
  const cfg = { ...DEFAULT_CONFIG, ...input };
  if (typeof cfg.basePath !== 'string' || !/^\/(?:[^/?#\\]+\/)+$/.test(cfg.basePath)) throw new Error('basePath debe ser una ruta absoluta terminada en /.');
  normalizePath(cfg.basePath, cfg.basePath);
  if (![cfg.title, cfg.subtitle].every(v => typeof v === 'string' && v.length <= 160)) throw new Error('Título o descripción no válidos.');
  if (!['grid', 'list'].includes(cfg.defaultView) || !['light', 'dark', 'system'].includes(cfg.defaultTheme)) throw new Error('Vista o tema no válido.');
  return cfg;
}

export function validateRules(input, basePath = '/downloads/') {
  const rules = Array.isArray(input) ? input : input?.rules;
  if (!Array.isArray(rules)) throw new Error('Usa un arreglo de reglas o un objeto con rules.');
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object' || (!rule.prefix && !rule.path)) throw new Error('Cada regla necesita prefix o path.');
    if (rule.prefix && (typeof rule.prefix !== 'string' || /[/\\\u0000-\u001f]/.test(rule.prefix))) throw new Error('Prefijo no válido.');
    if (rule.path && (typeof rule.path !== 'string' || normalizePath(rule.path, basePath, rule.path.endsWith('/')) !== rule.path)) throw new Error('Ruta individual no válida.');
    if (rule.target !== undefined && !['folders', 'files', 'both'].includes(rule.target)) throw new Error('target debe ser folders, files o both.');
    if (rule.path && ((rule.path.endsWith('/') && rule.target === 'files') || (!rule.path.endsWith('/') && rule.target === 'folders'))) throw new Error('El alcance no coincide con el tipo de la ruta.');
    if (rule.hidden !== undefined && typeof rule.hidden !== 'boolean') throw new Error('hidden debe ser true o false.');
    if (rule.key !== undefined && (typeof rule.key !== 'string' || !rule.key)) throw new Error('La clave de la regla no puede estar vacía.');
    if (rule.keyHash !== undefined && !/^[a-f0-9]{64}$/.test(rule.keyHash)) throw new Error('keyHash debe ser SHA-256 hexadecimal.');
  }
  return input;
}

export function getRules(input) { return Array.isArray(input) ? input : input.rules; }
export function ruleFor(path, input, basePath = '/downloads/', isDir = path.endsWith('/')) {
  const rules = getRules(input);
  const names = path.slice(basePath.length).split('/').filter(Boolean).map(p => decodeURIComponent(p));
  const applies = rule => (rule.target || 'both') === 'both' || rule.target === (isDir ? 'folders' : 'files');
  const exact = rules.find(rule => rule.path === path && applies(rule));
  if (exact) return exact;
  const ownPrefix = rules.find(rule => rule.prefix && applies(rule) && names.at(-1)?.startsWith(rule.prefix));
  if (ownPrefix) return ownPrefix;
  const ancestor = rules.filter(rule => rule.path?.endsWith('/') && path.startsWith(rule.path) && applies(rule)).sort((a, b) => b.path.length - a.path.length)[0];
  if (ancestor) return ancestor;
  return rules.find(rule => rule.prefix && applies(rule) && rule.target !== 'files' && names.slice(0, -1).some(name => name.startsWith(rule.prefix))) || null;
}

export function setItemVisibility(input, path, hidden, basePath = '/downloads/', isDir = path.endsWith('/')) {
  validateRules(input, basePath);
  path = normalizePath(path, basePath, isDir);
  const copy = structuredClone(input);
  const rules = getRules(copy);
  const existing = rules.find(r => r.path === path);
  if (existing) existing.hidden = hidden;
  else rules.unshift({ path, hidden });
  return copy;
}
export function setFolderVisibility(input, path, hidden, basePath = '/downloads/') { return setItemVisibility(input, path, hidden, basePath, true); }

export function parseRecents(text, basePath = '/downloads/', origin = 'http://localhost') {
  try {
    const entries = parseJson(text || '[]'); if (!Array.isArray(entries)) return [];
    const seen = new Set();
    return entries.flatMap(entry => {
      try {
        if (!entry || typeof entry.isDir !== 'boolean' || !Number.isFinite(entry.visited)) return [];
        const itemPath = normalizePath(entry.path, basePath, entry.isDir, origin);
        if (itemPath === basePath || seen.has(itemPath)) return [];
        seen.add(itemPath);
        const name = decodeURIComponent(itemPath.replace(/\/$/, '').split('/').pop());
        return [{ path: itemPath, name, isDir: entry.isDir, type: entry.isDir ? 'folder' : name.split('.').pop().toLowerCase(), visited: entry.visited }];
      } catch { return []; }
    }).sort((a, b) => b.visited - a.visited).slice(0, 12);
  } catch { return []; }
}
export function rememberItem(entries, item, visited = Date.now()) {
  return [{ path: item.path, isDir: item.isDir, visited }, ...entries.filter(entry => entry.path !== item.path)].slice(0, 12);
}

export function parseDirectory(doc, path, basePath, origin) {
  const found = new Map();
  for (const link of doc.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('?')) continue;
    try {
      const url = new URL(href, origin + path);
      const isDir = url.pathname.endsWith('/');
      const fullPath = normalizePath(url.href, basePath, isDir, origin);
      if (!fullPath.startsWith(path) || fullPath === path) continue;
      const relative = fullPath.slice(path.length).replace(/\/$/, '');
      if (!relative || relative.includes('/')) continue;
      const name = decodeURIComponent(relative);
      const type = isDir ? 'folder' : name.split('.').pop().toLowerCase();
      found.set(fullPath, { path: fullPath, name, isDir, type });
    } catch { /* Parent, sort links, and outside links are not directory entries. */ }
  }
  return [...found.values()];
}
