const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const explorer = new URL('/explorer.html', location.origin);
if (params.has('open')) explorer.searchParams.set('open', params.get('open'));

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const label = theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
  $('landingTheme').setAttribute('aria-label', label);
  $('landingTheme').title = label;
}

let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
try { theme = localStorage.getItem('shefiles.theme') || theme; } catch {}
applyTheme(theme === 'dark' ? 'dark' : 'light');
$('landingTheme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('shefiles.theme', next); } catch {}
});

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}

async function loadRelease(id, manifestPath) {
  const card = $(id);
  const status = card.querySelector('.release-status');
  try {
    if (typeof manifestPath !== 'string' || !manifestPath.trim()) throw new Error();
    const manifestUrl = new URL(manifestPath, location.origin);
    const manifest = await fetchJson(manifestUrl);
    if (typeof manifest.DownloadUrl !== 'string' || !manifest.DownloadUrl.trim()) throw new Error();
    const target = new URL(manifest.DownloadUrl, manifestUrl);
    if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) throw new Error();
    const link = card.querySelector('a');
    link.href = target.href;
    link.hidden = false;
    card.dataset.state = 'ready';
    status.textContent = [manifest.LatestVersion ? 'Versión ' + manifest.LatestVersion : 'Versión publicada', manifest.ReleaseDate].filter(Boolean).join(' · ');
  } catch {
    card.dataset.state = 'unavailable';
    status.textContent = 'Descarga no disponible en este momento.';
  }
}

async function loadCatalog() {
  const config = await fetchJson('/download-center.json').catch(() => ({}));
  await Promise.all(['pms', 'pos', 'api'].map(id => loadRelease(id, config?.[id])));
}

function openLogin() {
  $('loginError').textContent = '';
  $('loginDialog').showModal();
  $('explorerPassword').focus();
}

$('openLogin').addEventListener('click', openLogin);
$('closeLogin').addEventListener('click', () => $('loginDialog').close());
$('loginDialog').addEventListener('close', () => { $('explorerPassword').value = ''; });
$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('loginSubmit').disabled = true;
  $('loginError').textContent = '';
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('explorerPassword').value })
    }).catch(() => {
      throw new Error('No se pudo conectar con el servicio del explorador.');
    });
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    const result = contentType === 'application/json' ? await response.json().catch(() => null) : null;
    if (!result) {
      throw new Error(`El servicio del explorador no respondió como se esperaba (HTTP ${response.status}). Revisa la conexión con el servidor de SHEFiles.`);
    }
    if (!response.ok) {
      throw new Error(typeof result.error === 'string' ? result.error : `No se pudo abrir el explorador (HTTP ${response.status}).`);
    }
    if (typeof result.csrf !== 'string' || !result.csrf) throw new Error('El servicio del explorador no confirmó la sesión.');
    location.assign(explorer.href);
  } catch (error) {
    $('loginError').textContent = error.message || 'No se pudo abrir el explorador.';
    $('explorerPassword').select();
  } finally {
    $('loginSubmit').disabled = false;
  }
});

if (params.has('login') || params.has('open')) openLogin();
loadCatalog();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistration('/').then(registration => {
    if (registration?.active && new URL(registration.active.scriptURL).pathname === '/sw.js') return registration.update();
  }).catch(() => {});
}
