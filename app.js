import { DEFAULT_CONFIG, MASTER_DIGEST, validateConfig, validateRules, normalizePath, parseDirectory, ruleFor, setItemVisibility, getRules, parseJson, parseRecents, rememberItem } from './file-model.js?v=2.0.1';
import { sha256 } from './password-hash.js?v=2.0.1';

const $ = id => document.getElementById(id);
const state = { config: { ...DEFAULT_CONFIG }, rules: [], screen: 'home', path: '/downloads/', items: [], view: 'list', filter: 'all', admin: false, revealed: new Set(), directScope: null, directFile: null, api: false, csrf: null, drafts: new Map(), revisions: new Map(), activeFile: 'protected-rules.json', loading: false, error: null, request: null, prompt: null, recents: [], directories: new Map(), directoryRequests: new Map(), expanded: new Set(), collapsed: new Set(), rulesMode: 'prefix' };
const storage = { get(key) { try { return localStorage.getItem('shefiles.' + key); } catch { return null; } }, set(key, value) { try { localStorage.setItem('shefiles.' + key, value); } catch {} } };
const icon = name => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon'); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', '#i-' + name); svg.append(use); return svg;
};
function element(tag, text, className) { const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; }
function button(text, glyph, onClick, className = 'button secondary') {
  const el = element('button', null, className); el.type = 'button'; if (glyph) el.append(icon(glyph)); if (text) el.append(element('span', text)); el.addEventListener('click', onClick); return el;
}
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('toast').hidden = true; }, 3500); }
function notice(message) { $('notice').textContent = message; $('notice').hidden = !message; }
function showDialog(id) { $(id).showModal(); }
function setTheme(theme, persist = false) {
  document.documentElement.dataset.theme = theme;
  $('theme').replaceChildren(icon(theme === 'dark' ? 'sun' : 'moon'));
  $('theme').setAttribute('aria-label', theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
  $('theme').title = $('theme').getAttribute('aria-label');
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#101118' : '#6548eb';
  if (persist) storage.set('theme', theme);
}
async function digest(value) {
  if (!crypto.subtle) return sha256(value);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function api(route, options = {}) {
  const response = await fetch(new URL('./api/' + route, location.href), { credentials: 'same-origin', cache: 'no-store', ...options, headers: { ...options.headers, ...(state.csrf ? { 'X-SHEFiles-CSRF': state.csrf } : {}) } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && route !== 'login') returnToLogin();
    throw new Error(result.error || `HTTP ${response.status}`);
  }
  return result;
}
function returnToLogin() {
  const current = new URL(location.href).searchParams.get('open');
  const next = new URLSearchParams({ login: '1' });
  if (current) next.set('open', current);
  location.replace('/?' + next);
}
async function readJson(file, fallback) {
  const response = await fetch(file, { cache: 'no-store' });
  if (response.status === 401) returnToLogin();
  if (response.status === 404 && fallback !== undefined) return fallback;
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.json();
}

function hiddenRule(item) { return ruleFor(item.path, state.rules, state.config.basePath, item.isDir); }
function isHidden(item) { const rule = hiddenRule(item); return Boolean(rule && rule.hidden !== false); }
function visible(item) {
  if (state.admin || item.path === state.directFile) return true;
  const rule = hiddenRule(item);
  if (!rule || rule.hidden === false || state.revealed.has(rule)) return true;
  // A shared link grants browsing within that folder, but not unrelated hidden children.
  return Boolean(state.directScope && ((item.path.startsWith(state.directScope) && ruleFor(state.directScope, state.rules, state.config.basePath) === rule) || (item.isDir && state.directScope.startsWith(item.path))));
}
function visibleItems() { return state.items.filter(visible); }
function formatPath(path) { try { return decodeURIComponent(path); } catch { return path; } }
function updateURL(path, screen, historyMode) {
  const url = new URL(location.href); url.search = ''; url.hash = '';
  if (screen === 'explorer') url.searchParams.set('open', path);
  if (historyMode !== 'none') history[historyMode === 'replace' ? 'replaceState' : 'pushState']({ path, screen }, '', url);
}
function showHome(historyMode = 'push') {
  state.screen = 'home'; state.directScope = null; state.directFile = null;
  updateURL(state.config.basePath, 'home', historyMode);
  resetNavigation();
  return loadDirectory(state.config.basePath);
}
function navigate(path, { historyMode = 'push', direct = false, directFile = null } = {}) {
  try { path = normalizePath(path, state.config.basePath, true, location.origin); }
  catch (error) { notice(error.message); return Promise.resolve(); }
  if (direct) state.directScope = path;
  if (state.directScope && !path.startsWith(state.directScope)) state.directScope = null;
  state.directFile = directFile; state.screen = 'explorer';
  updateURL(path, 'explorer', historyMode);
  resetNavigation();
  return loadDirectory(path);
}
function resetNavigation() {
  state.filter = 'all'; $('search').value = '';
  document.querySelectorAll('[data-filter]').forEach(control => control.setAttribute('aria-pressed', String(control.dataset.filter === 'all')));
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}
async function directoryItems(path, signal) {
  const response = await fetch(path, { cache: 'no-store', signal });
  if (response.status === 401) returnToLogin();
  if (!response.ok) throw new Error(`El directorio respondió HTTP ${response.status}.`);
  const html = await response.text();
  const items = parseDirectory(new DOMParser().parseFromString(html, 'text/html'), path, state.config.basePath, location.origin);
  if (!items.length && !/index of|directory listing|<pre|<table|data-shefiles-listing/i.test(html)) throw new Error('El servidor no devolvió un listado de directorio. Revisa que esté habilitado para esta ruta.');
  return items;
}
async function ensureDirectory(path) {
  if (state.directories.has(path)) return state.directories.get(path);
  if (!state.directoryRequests.has(path)) {
    const base = state.config.basePath;
    const pending = directoryItems(path).then(items => { if (base === state.config.basePath) state.directories.set(path, items); return items; }).finally(() => state.directoryRequests.delete(path));
    state.directoryRequests.set(path, pending);
  }
  return state.directoryRequests.get(path);
}
function remember(item) {
  if (item.path === state.config.basePath) return;
  state.recents = parseRecents(JSON.stringify(rememberItem(state.recents, item)), state.config.basePath, location.origin);
  storage.set('recents', JSON.stringify(state.recents));
}
async function loadDirectory(path) {
  state.request?.abort(); const controller = new AbortController(); state.request = controller;
  state.path = path; state.items = []; state.loading = true; state.error = null;
  $('search').value = ''; render(); renderPath();
  try {
    const items = await directoryItems(path, controller.signal);
    if (controller.signal.aborted) return;
    state.items = items; state.directories.set(path, items);
    if (path !== state.config.basePath) remember({ path, isDir: true });
  } catch (error) { if (controller.signal.aborted) return; state.error = error.message; }
  if (controller.signal.aborted) return;
  state.loading = false; render();
  if (path !== state.config.basePath) {
    const parts = path.slice(state.config.basePath.length).split('/').filter(Boolean); let parent = state.config.basePath; const ancestors = [parent];
    parts.slice(0, -1).forEach(part => { parent += part + '/'; ancestors.push(parent); });
    Promise.allSettled(ancestors.map(ensureDirectory)).then(renderSidebar);
  }
}
function renderPath() {
  const root = state.config.basePath; const parts = state.path.slice(root.length).split('/').filter(Boolean);
  $('folderTitle').textContent = parts.length ? formatPath(parts.at(-1)) : 'Todos los archivos';
  $('pathStatus').textContent = formatPath(state.path);
  $('homeView').hidden = state.screen !== 'home'; $('explorerView').hidden = state.screen === 'home';
  $('home').classList.toggle('active', state.screen === 'home'); $('browse').classList.toggle('active', state.screen === 'explorer');
  $('home').setAttribute('aria-current', state.screen === 'home' ? 'page' : 'false'); $('browse').setAttribute('aria-current', state.screen === 'explorer' ? 'page' : 'false');
  $('mobileHome').setAttribute('aria-current', state.screen === 'home' ? 'page' : 'false'); $('mobileBrowse').setAttribute('aria-current', state.screen === 'explorer' ? 'page' : 'false');
  $('topbarTitle').textContent = state.screen === 'home' ? 'Inicio' : formatPath(state.path.slice(root.length).replace(/\/$/, '')) || 'Todos los archivos';
  const bar = $('breadcrumbs'); bar.replaceChildren();
  const home = button('Archivos', 'folder', () => navigate(root), ''); bar.append(home);
  let path = root;
  parts.forEach((part, index) => { path += part + '/'; const target = path; bar.append(icon('chevron')); const link = button(formatPath(part), null, () => navigate(target), ''); if (index === parts.length - 1) link.setAttribute('aria-current', 'page'); bar.append(link); });
  if (!parts.length) home.setAttribute('aria-current', 'page');
}
function renderSidebar() {
  const nav = $('sidebarDirs'); nav.replaceChildren();
  const roots = state.directories.get(state.config.basePath) || [];
  function branch(items, depth = 0) {
    const list = element('ul', null, 'folder-tree');
    items.filter(item => item.isDir && visible(item)).sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true })).forEach(item => {
      const li = element('li'); const row = element('div', null, 'tree-row');
      const expanded = !state.collapsed.has(item.path) && (state.expanded.has(item.path) || (state.screen === 'explorer' && state.path.startsWith(item.path)));
      const toggle = button(null, 'chevron', async () => {
        if (expanded) { state.collapsed.add(item.path); state.expanded.delete(item.path); renderSidebar(); }
        else { state.collapsed.delete(item.path); state.expanded.add(item.path); toggle.disabled = true; try { await ensureDirectory(item.path); renderSidebar(); } catch (error) { state.expanded.delete(item.path); toast(error.message); renderSidebar(); } }
      }, 'tree-toggle');
      toggle.setAttribute('aria-expanded', String(expanded)); toggle.setAttribute('aria-label', (expanded ? 'Contraer ' : 'Expandir ') + item.name);
      const link = button(item.name, 'folder', () => navigate(item.path), 'sidebar-dir');
      if (state.screen === 'explorer' && state.path === item.path) { link.setAttribute('aria-current', 'page'); row.classList.add('current'); }
      else if (state.screen === 'explorer' && state.path.startsWith(item.path)) row.classList.add('ancestor');
      row.append(toggle, link); li.append(row);
      const children = state.directories.get(item.path);
      if (expanded && children && depth < 20) li.append(branch(children, depth + 1));
      list.append(li);
    });
    return list;
  }
  const tree = branch(roots); nav.append(tree);
  if (!tree.children.length) nav.append(element('p', state.loading ? 'Cargando carpetas…' : 'No hay carpetas visibles.', 'sidebar-empty'));
}
function recentVisible(item) {
  if (!visible(item)) return false;
  const parts = item.path.slice(state.config.basePath.length).split('/').filter(Boolean); if (!item.isDir) parts.pop();
  let parent = state.config.basePath;
  return parts.every(part => { parent += part + '/'; return visible({ path: parent, isDir: true }); });
}
function renderRecent(item) {
  const row = item.isDir ? button(null, null, () => navigate(item.path), 'recent-item') : element('a', null, 'recent-item');
  if (!item.isDir) { row.href = item.path; row.download = item.name; row.addEventListener('click', () => remember(item)); }
  const visual = element('span', null, 'file-icon ' + (item.isDir ? 'folder' : item.type === 'json' ? 'json' : '')); visual.append(icon(item.isDir ? 'folder' : item.type === 'json' ? 'code' : 'file'));
  const copy = element('span', null, 'recent-copy'); copy.append(element('strong', item.name), element('small', formatPath(item.path.slice(state.config.basePath.length))));
  row.append(visual, copy, icon(item.isDir ? 'chevron' : 'down')); return row;
}
function renderHome() {
  const available = state.recents.filter(recentVisible);
  for (const [id, isDir] of [['recentFolders', true], ['recentFiles', false]]) {
    const section = $(id); section.replaceChildren(); const items = available.filter(item => item.isDir === isDir).slice(0, 3);
    items.forEach(item => section.append(renderRecent(item)));
    if (!items.length) section.append(element('p', isDir ? 'Las carpetas que abras aparecerán aquí.' : 'Los archivos que descargues aparecerán aquí.', 'recent-empty'));
  }
  const quick = $('quickFolders'); quick.replaceChildren();
  if (state.loading) { quick.append(element('p', 'Cargando carpetas…', 'recent-empty')); return; }
  if (state.error) { quick.append(empty('No se pudieron cargar las carpetas', state.error, 'info', true)); return; }
  const folders = (state.directories.get(state.config.basePath) || []).filter(item => item.isDir && visible(item)).slice(0, 6);
  folders.forEach(item => quick.append(renderRecent(item)));
  if (!folders.length) quick.append(element('p', 'No hay carpetas visibles. Puedes abrir el explorador o ingresar una clave.', 'recent-empty'));
  $('clearRecents').hidden = !state.recents.length;
}
function renderSession() {
  $('sessionBadge').hidden = !state.admin;
  $('lock').hidden = !state.admin && !state.revealed.size;
  $('unlock').hidden = state.admin;
}
function installRules(data) {
  state.rules = data;
  if (state.legacyFolder) {
    const legacyPath = state.config.basePath + encodeURIComponent(state.legacyFolder) + '/';
    if (!getRules(state.rules).some(rule => rule.prefix === state.legacyFolder || rule.path === legacyPath)) getRules(state.rules).push({ path: legacyPath, hidden: true });
  }
}
function empty(title, message, glyph = 'folder', retry = false) {
  const el = element('div', null, 'empty'); el.append(icon(glyph), element('h3', title), element('p', message));
  if (retry) el.append(button('Reintentar', 'refresh', () => loadDirectory(state.path)));
  return el;
}
function render() {
  renderPath(); renderSidebar(); renderHome();
  const list = $('files'); list.className = state.view === 'grid' ? 'file-grid' : 'file-list'; list.replaceChildren(); list.setAttribute('aria-busy', String(state.loading));
  $('listView').setAttribute('aria-pressed', String(state.view === 'list')); $('gridView').setAttribute('aria-pressed', String(state.view === 'grid'));
  if (state.loading) { list.append(empty('Cargando archivos…', 'Preparando el contenido de esta carpeta.')); $('itemCount').textContent = 'Cargando…'; $('status').textContent = 'Conectando…'; return; }
  if (state.error) { list.append(empty(navigator.onLine ? 'No se pudo abrir la carpeta' : 'Sin conexión', state.error, 'info', true)); $('itemCount').textContent = 'Contenido no disponible'; $('status').textContent = 'Error al cargar'; return; }
  const accessible = visibleItems();
  const query = $('search').value.trim().toLocaleLowerCase('es');
  let items = accessible.filter(i => i.name.toLocaleLowerCase('es').includes(query) && (state.filter === 'all' || (state.filter === 'folder' ? i.isDir : !i.isDir)));
  const sort = $('sort').value;
  items.sort((a, b) => { if (sort === 'folders-az' && a.isDir !== b.isDir) return a.isDir ? -1 : 1; if (sort === 'type' && a.type !== b.type) return a.type.localeCompare(b.type); return a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' }) * (sort === 'name-za' ? -1 : 1); });
  const folderCount = accessible.filter(i => i.isDir).length;
  $('itemCount').textContent = `${items.length} ${items.length === 1 ? 'elemento' : 'elementos'} · ${folderCount} ${folderCount === 1 ? 'carpeta' : 'carpetas'}`;
  $('status').textContent = 'Actualizado · Descargas disponibles';
  if (state.path !== state.config.basePath) { const parent = state.path.slice(0, -1).slice(0, state.path.slice(0, -1).lastIndexOf('/') + 1); const up = button('Subir un nivel', 'up', () => navigate(parent)); const wrap = element('div', null, 'up-row'); wrap.append(up); list.append(wrap); }
  if (!items.length) { list.append(empty(query || state.filter !== 'all' ? 'Sin resultados' : 'No hay archivos visibles', query ? 'Prueba con otro nombre o quita los filtros.' : 'Puedes actualizar o ingresar una clave para ver carpetas ocultas.')); return; }
  items.forEach(item => list.append(renderItem(item)));
}
function shareURL(item, direct = false) {
  if (direct) return new URL(item.path, location.origin).href;
  const url = new URL(location.pathname, location.origin); url.searchParams.set(item.isDir ? 'open' : 'download', item.path); return url.href;
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Enlace copiado'); }
  catch { const field = element('textarea'); field.value = text; field.style.position = 'fixed'; field.style.left = '-9999px'; document.body.append(field); field.select(); const success = document.execCommand('copy'); field.remove(); toast(success ? 'Enlace copiado' : 'No se pudo copiar. Abre los detalles para seleccionar el enlace.'); }
}
function download(item) { remember(item); const a = element('a'); a.href = item.path; a.download = item.name; document.body.append(a); a.click(); a.remove(); }
function renderItem(item) {
  const row = element('article', null, 'file-row');
  const archive = ['zip', 'exe', 'msi', 'rar', '7z', 'dmg', 'apk'].includes(item.type);
  const glyph = item.isDir ? 'folder' : item.type === 'json' ? 'code' : archive ? 'package' : 'file';
  const visual = element('div', null, 'file-icon ' + (item.isDir ? 'folder' : item.type === 'json' ? 'json' : archive ? 'package' : '')); visual.append(icon(glyph)); row.append(visual);
  const body = element('div', null, 'file-body');
  const title = item.isDir ? button(item.name, null, () => navigate(item.path), 'file-title') : element('a', item.name, 'file-title');
  if (!item.isDir) { title.href = item.path; title.download = item.name; title.addEventListener('click', () => remember(item)); }
  const meta = element('span', item.isDir ? 'Carpeta de archivos' : item.type === 'json' ? 'Configuración · JSON' : archive ? 'Paquete de distribución' : 'Archivo disponible', 'file-meta');
  if (isHidden(item)) meta.append(element('span', item.isDir ? 'Carpeta oculta' : 'Archivo oculto', 'ap-badge ap-badge--warning'));
  title.replaceChildren(element('span', item.name), meta); title.setAttribute('aria-label', item.name);
  body.append(title); row.append(body, element('span', item.isDir ? 'Carpeta' : item.type.slice(0, 12), 'type-badge'));
  const actions = element('div', null, 'row-actions');
  if (item.isDir) actions.append(button('Abrir', 'chevron', () => navigate(item.path), 'button quiet'));
  else { const a = element('a', null, 'button download'); a.href = item.path; a.download = item.name; a.setAttribute('aria-label', 'Descargar ' + item.name); a.title = 'Descargar ' + item.name; a.addEventListener('click', () => remember(item)); a.append(icon('down'), element('span', 'Descargar')); actions.append(a); }
  const share = button(null, 'link', () => copy(shareURL(item)), 'icon-button'); share.setAttribute('aria-label', 'Copiar enlace de ' + item.name); share.title = 'Copiar enlace';
  const details = button(null, 'info', () => showProperties(item), 'icon-button'); details.setAttribute('aria-label', 'Detalles de ' + item.name); details.title = 'Detalles y opciones';
  actions.append(share, details); row.append(actions); return row;
}
function showProperties(item) {
  $('propertiesTitle').textContent = item.name; const content = $('propertiesContent'); content.replaceChildren();
  const fields = [['Tipo', item.isDir ? 'Carpeta' : item.type.toUpperCase()], ['Ruta', formatPath(item.path)], ['Enlace para compartir', shareURL(item)], ['Enlace directo', shareURL(item, true)]];
  fields.forEach(([label, value]) => content.append(element('div', label, 'property-label'), element('span', value, 'property-value')));
  content.append(element('p', 'La visibilidad solo afecta al explorador. Cualquier persona con el enlace puede acceder.'));
  const actions = $('propertiesActions'); actions.replaceChildren();
  actions.append(button((isHidden(item) ? 'Mostrar ' : 'Ocultar ') + (item.isDir ? 'carpeta' : 'archivo'), 'eye', () => { $('propertiesDialog').close(); requireAdmin(() => toggleVisibility(item)); }));
  if (!item.isDir && item.type === 'json') actions.append(button('Editar JSON', 'code', () => { $('propertiesDialog').close(); requireAdmin(() => openSettings(item.path)); }));
  actions.append(button('Copiar enlace', 'link', () => copy(shareURL(item)), 'button primary')); showDialog('propertiesDialog');
}
function promptPassword(admin, action) {
  state.prompt = { admin, action }; $('passwordTitle').textContent = admin ? 'Administrar SHEFiles' : 'Ver contenido oculto';
  $('passwordHelp').textContent = admin ? 'Ingresa la clave maestra para administrar la visibilidad y editar JSON.' : 'Ingresa una clave de acceso o la clave maestra. El acceso termina al bloquear o cerrar esta página.';
  $('password').value = ''; $('password').type = 'password'; $('passwordError').textContent = ''; $('passwordEye').setAttribute('aria-pressed', 'false'); $('passwordEye').setAttribute('aria-label', 'Mostrar clave'); showDialog('passwordDialog'); $('password').focus();
}
function requireAdmin(action) { if (state.admin) action(); else promptPassword(true, action); }
async function submitPassword(event) {
  event.preventDefault(); $('passwordSubmit').disabled = true; $('passwordError').textContent = '';
  try {
    const key = $('password').value; const hash = await digest(key); const prompt = state.prompt;
    let master = hash === MASTER_DIGEST;
    if (master || prompt.admin) {
      if (state.api) { const result = await api('login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: key }) }); state.csrf = result.csrf; master = true; }
      else if (!master) throw new Error('Clave maestra incorrecta.');
    }
    if (master) state.admin = true;
    else {
      const matches = getRules(state.rules).filter(rule => rule.hidden !== false && (rule.keyHash ? rule.keyHash === hash : rule.key === key));
      if (!matches.length) throw new Error('Clave incorrecta. Vuelve a intentarlo.');
      matches.forEach(rule => state.revealed.add(rule));
    }
    $('passwordDialog').close(); $('password').value = ''; renderSession(); render(); toast(master ? 'Administración desbloqueada' : 'Contenido desbloqueado');
    if (prompt.action) await prompt.action();
  } catch (error) { $('passwordError').textContent = error.message; $('password').value = ''; $('password').focus(); }
  finally { $('passwordSubmit').disabled = false; }
}
async function lock() {
  try {
    await api('logout', { method: 'POST' });
    location.replace('/');
  } catch (error) {
    toast(error.message);
  }
}
function preserveDraft() { if ($('settingsDialog').open && !$('configEditor').disabled) state.drafts.set(state.activeFile, $('configEditor').value); }
function validEditor(text = $('configEditor').value, file = state.activeFile) {
  const data = parseJson(text);
  if (file === 'protected-rules.json') validateRules(data, state.config.basePath);
  if (file === 'explorer-config.json') { const config = validateConfig(data); validateRules(state.rules, config.basePath); }
  return { text, data };
}
function editorError(error) { $('editorError').textContent = error instanceof SyntaxError ? 'JSON no válido. Revise las comillas, comas y llaves antes de guardar.' : error.message; $('saveResult').textContent = ''; }
function changeRules(change) {
  if (state.editorBusy) return false;
  try {
    const data = parseJson($('configEditor').value); validateRules(data, state.config.basePath);
    change(getRules(data)); validateRules(data, state.config.basePath);
    $('configEditor').value = JSON.stringify(data, null, 2) + '\n'; preserveDraft(); $('editorError').textContent = '';
    $('saveResult').textContent = state.api ? 'Cambios preparados. Guarde para aplicarlos.' : 'Cambios preparados. Exporte el JSON para publicarlos.';
    renderRuleEditor(); return true;
  } catch (error) { editorError(error); return false; }
}
function editorBusy(busy) {
  state.editorBusy = busy;
  for (const id of ['configEditor', 'formatJson', 'importJson', 'prefixMode', 'jsonMode', 'exportJson', 'configFile']) $(id).disabled = busy;
  $('rulesPanel').inert = busy; $('saveJson').disabled = busy || !state.api || !state.admin;
  $('settingsDialog').setAttribute('aria-busy', String(busy));
}
function renderRuleEditor() {
  const focusedLabel = document.activeElement?.getAttribute('aria-label');
  const rulesFile = state.activeFile === 'protected-rules.json';
  $('rulesTabs').hidden = !rulesFile; $('rulesPanel').hidden = !rulesFile || state.rulesMode !== 'prefix'; $('jsonPanel').hidden = rulesFile && state.rulesMode !== 'json';
  $('prefixMode').setAttribute('aria-pressed', String(state.rulesMode === 'prefix')); $('jsonMode').setAttribute('aria-pressed', String(state.rulesMode === 'json'));
  if (!rulesFile || state.rulesMode !== 'prefix') return;
  try {
    const data = parseJson($('configEditor').value); validateRules(data, state.config.basePath); const rules = getRules(data);
    const prefixes = $('prefixRules'); const individual = $('individualRules'); prefixes.replaceChildren(); individual.replaceChildren();
    rules.forEach((rule, index) => {
      const row = element('div', null, 'prefix-rule');
      const identity = element('div', null, 'rule-identity'); identity.append(element('strong', rule.prefix || formatPath(rule.path)));
      if (rule.key || rule.keyHash) identity.append(element('small', 'Clave de acceso configurada'));
      row.append(identity);
      if (rule.prefix) {
        const target = element('select', null, 'ap-select'); target.setAttribute('aria-label', 'Alcance de ' + rule.prefix);
        for (const [value, text] of [['both', 'Carpetas y archivos'], ['folders', 'Solo carpetas'], ['files', 'Solo archivos']]) { const option = element('option', text); option.value = value; target.append(option); }
        target.value = rule.target || 'both'; target.addEventListener('change', () => changeRules(list => { list[index].target = target.value; })); row.append(target);
      }
      const label = element('label', null, 'rule-switch'); const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = rule.hidden !== false;
      checkbox.setAttribute('aria-label', 'Ocultar ' + (rule.prefix || formatPath(rule.path)));
      checkbox.addEventListener('change', () => changeRules(list => { list[index].hidden = checkbox.checked; })); label.append(checkbox, element('span', 'Ocultar')); row.append(label);
      const remove = button(null, 'close', () => changeRules(list => { list.splice(index, 1); }), 'icon-button'); remove.setAttribute('aria-label', 'Quitar ' + (rule.prefix ? 'prefijo ' + rule.prefix : 'regla ' + formatPath(rule.path))); remove.title = 'Quitar regla'; row.append(remove);
      (rule.prefix ? prefixes : individual).append(row);
    });
    if (!prefixes.children.length) prefixes.append(element('p', 'No hay prefijos. Agregue uno para ocultar nombres coincidentes.', 'recent-empty'));
    if (!individual.children.length) individual.append(element('p', 'Use los detalles de un archivo o carpeta para crear una regla individual.', 'recent-empty'));
    $('individualSummary').textContent = `Reglas individuales (${individual.querySelectorAll('.prefix-rule').length})`;
    if (focusedLabel) [...$('rulesPanel').querySelectorAll('[aria-label]')].find(control => control.getAttribute('aria-label') === focusedLabel)?.focus({ preventScroll: true });
  } catch (error) { state.rulesMode = 'json'; $('rulesPanel').hidden = true; $('jsonPanel').hidden = false; $('prefixMode').setAttribute('aria-pressed', 'false'); $('jsonMode').setAttribute('aria-pressed', 'true'); editorError(error); }
}
async function loadEditor(file) {
  const requestId = (state.editorRequest || 0) + 1; state.editorRequest = requestId;
  state.activeFile = file; $('configFile').value = file; $('editorError').textContent = ''; $('saveResult').textContent = 'Cargando configuración…'; editorBusy(true);
  try {
    let content = state.drafts.get(file);
    if (content === undefined) {
      if (state.api) { const result = await api('file?path=' + encodeURIComponent(file)); content = result.content; state.revisions.set(file, result.revision); }
      else { const result = file === 'protected-rules.json' ? state.rules : file === 'explorer-config.json' ? state.config : await readJson(file); content = JSON.stringify(result, null, 2) + '\n'; }
    }
    if (requestId !== state.editorRequest) return;
    $('configEditor').value = content;
    $('saveResult').textContent = ''; state.rulesMode = 'prefix'; renderRuleEditor();
  } catch (error) { if (requestId === state.editorRequest) { $('configEditor').value = ''; editorError(error); } }
  finally { if (requestId === state.editorRequest) editorBusy(false); }
}
async function openSettings(file = 'protected-rules.json') {
  if (!state.admin) return;
  if (![...$('configFile').options].some(o => o.value === file)) { const option = element('option', formatPath(file)); option.value = file; $('configFile').append(option); }
  $('saveMode').textContent = state.api ? 'Guardado protegido disponible. Se crea una copia antes de reemplazar el JSON.' : 'Hosting estático: exporta el JSON y reemplázalo en tu hosting. Los cambios no se guardan en el servidor desde este navegador.';
  $('saveJson').hidden = !state.api;
  showDialog('settingsDialog'); await loadEditor(file);
}
async function saveFile(file, content, revision) {
  return api('file', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: file, content, revision }) });
}
async function applyEdited(file, data) {
  if (file === 'protected-rules.json') { installRules(data); state.revealed.clear(); render(); }
  if (file === 'explorer-config.json') { const home = state.screen === 'home'; state.config = validateConfig(data); state.directories.clear(); state.recents = parseRecents(storage.get('recents'), state.config.basePath, location.origin); applyConfig(); if (home) await showHome(); else await navigate(state.config.basePath); }
  if (file.startsWith(state.config.basePath)) await loadDirectory(state.path);
}
async function saveEditor() {
  if (state.editorBusy || !state.api || !state.admin) return;
  state.editorSaving = true; editorBusy(true); $('settingsDialog').querySelector('[data-close]').disabled = true;
  try {
    const { text, data } = validEditor(); const file = state.activeFile;
    const result = await saveFile(file, text, state.revisions.get(file));
    state.revisions.set(file, result.revision); state.drafts.delete(file); await applyEdited(file, data);
    $('editorError').textContent = ''; $('saveResult').textContent = 'Guardado en servidor. Copia de respaldo creada.'; toast('JSON guardado'); notice('');
  } catch (error) { editorError(error); }
  finally { state.editorSaving = false; $('settingsDialog').querySelector('[data-close]').disabled = false; editorBusy(false); }
}
async function exportEditor() {
  if (state.editorBusy) return;
  try {
    const { text, data } = validEditor(); const file = state.activeFile;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const link = element('a'); link.href = url; link.download = file.split('/').pop(); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (!state.api) await applyEdited(file, data);
    $('editorError').textContent = ''; $('saveResult').textContent = 'JSON exportado. Reemplaza el archivo en su ruta original para publicarlo.';
    if (!state.api) notice('Hay cambios preparados en este navegador. Exporta el JSON y reemplázalo en el hosting para que los vean todos.');
  } catch (error) { editorError(error); }
}
async function toggleVisibility(item) {
  try {
    let source = state.rules; let revision;
    if (state.api) { const result = await api('file?path=protected-rules.json'); source = parseJson(result.content); revision = result.revision; }
    const active = ruleFor(item.path, source, state.config.basePath, item.isDir);
    const next = setItemVisibility(source, item.path, !(active && active.hidden !== false), state.config.basePath, item.isDir); const text = JSON.stringify(next, null, 2) + '\n';
    if (state.api) { const result = await saveFile('protected-rules.json', text, revision); state.revisions.set('protected-rules.json', result.revision); state.drafts.delete('protected-rules.json'); installRules(next); render(); toast('Visibilidad guardada'); }
    else { installRules(next); state.drafts.set('protected-rules.json', text); render(); notice('Visibilidad preparada. Exporta protected-rules.json y reemplázalo en el hosting para guardar el cambio.'); await openSettings(); }
  } catch (error) { toast(error.message); }
}
function applyConfig() {
  state.recents = parseRecents(JSON.stringify(state.recents), state.config.basePath, location.origin);
  document.title = state.config.title + ' · Explorador de archivos'; document.querySelector('[data-brand]').textContent = state.config.title; $('subtitle').textContent = state.config.subtitle;
  state.view = storage.get('view') || state.config.defaultView;
  const preference = storage.get('theme') || state.config.defaultTheme;
  setTheme(preference === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference);
}
async function handleURL(historyMode = 'replace') {
  const params = new URLSearchParams(location.search);
  try {
    if (params.has('download')) {
      const path = normalizePath(params.get('download'), state.config.basePath, false, location.origin);
      const item = { path, name: formatPath(path.split('/').pop()), isDir: false };
      await navigate(path.slice(0, path.lastIndexOf('/') + 1), { historyMode, direct: true, directFile: path });
      download(item); toast('Descarga solicitada');
    } else if (params.has('open')) await navigate(params.get('open'), { historyMode, direct: true });
    else await showHome(historyMode);
  } catch (error) { notice(error.message); await showHome(historyMode); }
}
async function retireReaderWorker() {
  // Retire only the former reader worker; never clear unrelated origin caches.
  if (!('serviceWorker' in navigator)) return;
  try { for (const registration of await navigator.serviceWorker.getRegistrations()) { const worker = registration.active || registration.waiting; if (worker && new URL(worker.scriptURL).pathname === new URL('sw.js', location.href).pathname) await registration.unregister(); } if ('caches' in window) for (const key of await caches.keys()) if (key.startsWith('she-books-')) await caches.delete(key); } catch {}
}
function wireEvents() {
  $('home').addEventListener('click', () => showHome()); $('mobileHome').addEventListener('click', () => showHome());
  for (const id of ['browse', 'mobileBrowse', 'openExplorer']) $(id).addEventListener('click', () => navigate(state.config.basePath));
  $('clearRecents').addEventListener('click', () => { state.recents = []; storage.set('recents', '[]'); renderHome(); toast('Recientes limpiados'); });
  $('refresh').addEventListener('click', () => loadDirectory(state.path));
  $('theme').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true));
  $('search').addEventListener('input', render); $('sort').addEventListener('change', render);
  for (const view of ['list', 'grid']) $(view + 'View').addEventListener('click', () => { state.view = view; storage.set('view', view); render(); });
  document.querySelectorAll('[data-filter]').forEach(el => el.addEventListener('click', () => { state.filter = el.dataset.filter; document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b === el))); render(); }));
  $('unlock').addEventListener('click', () => promptPassword(false)); $('settings').addEventListener('click', () => requireAdmin(() => openSettings())); $('lock').addEventListener('click', lock);
  $('passwordForm').addEventListener('submit', submitPassword); $('passwordEye').addEventListener('click', () => { const show = $('password').type === 'password'; $('password').type = show ? 'text' : 'password'; $('passwordEye').setAttribute('aria-pressed', String(show)); $('passwordEye').setAttribute('aria-label', show ? 'Ocultar clave' : 'Mostrar clave'); });
  document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => el.closest('dialog').close()));
  $('settingsDialog').addEventListener('cancel', event => { if (state.editorSaving) event.preventDefault(); });
  $('passwordDialog').addEventListener('close', () => { $('password').value = ''; });
  $('configFile').addEventListener('change', () => { preserveDraft(); loadEditor($('configFile').value); });
  $('configEditor').addEventListener('input', () => { state.drafts.set(state.activeFile, $('configEditor').value); $('saveResult').textContent = ''; });
  $('prefixMode').addEventListener('click', () => { state.rulesMode = 'prefix'; renderRuleEditor(); }); $('jsonMode').addEventListener('click', () => { state.rulesMode = 'json'; renderRuleEditor(); });
  $('prefixForm').addEventListener('submit', event => { event.preventDefault(); if (changeRules(rules => { const prefix = $('newPrefix').value.trim(); if (!prefix) throw new Error('Escriba un prefijo.'); if (rules.some(rule => rule.prefix === prefix)) throw new Error('Ese prefijo ya existe. Modifique su alcance en la lista.'); rules.push({ prefix, target: $('newTarget').value, hidden: true }); })) $('newPrefix').value = ''; });
  $('formatJson').addEventListener('click', () => { try { const { data } = validEditor(); $('configEditor').value = JSON.stringify(data, null, 2) + '\n'; preserveDraft(); $('editorError').textContent = ''; } catch (error) { editorError(error); } });
  $('importJson').addEventListener('change', async () => {
    if (state.editorBusy) return;
    const file = $('importJson').files[0]; if (!file) return;
    const requestId = state.editorRequest; const activeFile = state.activeFile;
    editorBusy(true);
    try {
      if (file.size > 1024 * 1024) throw new Error('El JSON debe ser menor de 1 MB.');
      const text = await file.text();
      if (requestId !== state.editorRequest || activeFile !== state.activeFile) return;
      validEditor(text);
      $('configEditor').value = text; state.drafts.set(state.activeFile, text); $('editorError').textContent = '';
      $('saveResult').textContent = 'JSON importado. Revise los cambios antes de guardarlos.'; renderRuleEditor();
    } catch (error) { if (requestId === state.editorRequest) editorError(error); }
    finally { if (requestId === state.editorRequest) { $('importJson').value = ''; editorBusy(false); } }
  });
  $('saveJson').addEventListener('click', saveEditor); $('exportJson').addEventListener('click', exportEditor);
  window.addEventListener('popstate', () => handleURL('none'));
  window.addEventListener('offline', () => { $('status').textContent = 'Sin conexión · El contenido puede estar desactualizado'; });
  window.addEventListener('online', () => loadDirectory(state.path));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => { if (!storage.get('theme') && state.config.defaultTheme === 'system') setTheme(e.matches ? 'dark' : 'light'); });
}
async function init() {
  const session = await api('session');
  state.admin = true;
  state.csrf = session.csrf;
  wireEvents();
  window.addEventListener('pageshow', event => {
    if (event.persisted) api('session').catch(() => {});
  });
  const results = await Promise.allSettled([readJson('explorer-config.json', DEFAULT_CONFIG), readJson('protected-rules.json'), readJson('ereader-config.json', {}), api('capabilities', { signal: AbortSignal.timeout(3500) })]);
  try { if (results[0].status === 'fulfilled') state.config = validateConfig(results[0].value); else throw results[0].reason; } catch (error) { notice('No se pudo cargar la configuración del explorador. ' + error.message); }
  try { if (results[1].status === 'fulfilled') state.rules = validateRules(results[1].value, state.config.basePath); else throw results[1].reason; } catch (error) { state.rules = [{ path: state.config.basePath, hidden: true }]; notice('No se pudieron cargar las reglas de visibilidad. Las carpetas quedan ocultas hasta corregir la configuración. Los enlaces directos siguen disponibles.'); }
  if (results[2].status === 'fulfilled' && typeof results[2].value.booksFolder === 'string' && results[2].value.booksFolder) { state.legacyFolder = results[2].value.booksFolder; installRules(state.rules); }
  state.api = results[3].status === 'fulfilled' && results[3].value.service === 'shefiles' && results[3].value.editing === true;
  state.recents = parseRecents(storage.get('recents'), state.config.basePath, location.origin);
  applyConfig(); renderSession(); await handleURL(); retireReaderWorker();
}
init().catch(error => { notice('No se pudo iniciar el explorador. ' + error.message); $('files').replaceChildren(empty('Error al iniciar', 'Actualiza la página para volver a intentar.', 'info')); });
