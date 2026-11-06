import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';

async function setup(t, options = {}) {
  const folder = await mkdtemp(path.join(tmpdir(), 'shefiles-landing-'));
  const downloads = path.join(folder, 'downloads');
  await mkdir(downloads);
  await writeFile(path.join(downloads, 'pms.zip'), 'test release');
  const manifest = JSON.stringify({ LatestVersion: '6.0.0', DownloadUrl: 'pms.zip' });
  await writeFile(path.join(downloads, 'SHE.Endevour.json'), manifest);
  const server = createServer({ downloads, privateDir: path.join(folder, 'private'), ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(folder, { recursive: true, force: true });
  });
  const request = (url, init) => fetch(origin + url, init);
  const login = password => request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ password })
  });
  return { request, login, manifest };
}

test('the landing is always public and the explorer and directory index require a password session', async t => {
  const { request, login } = await setup(t);
  for (const url of ['/', '/index.html', '/?open=%2Fdownloads%2F']) {
    const page = await request(url);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    const html = await page.text();
    assert.match(html, /Centro de descargas/);
    for (const name of ['PMS', 'POS', 'API']) assert.match(html, new RegExp('Descargar ' + name));
    assert.doesNotMatch(html, /id="explorerView"/);
  }
  const guest = await request('/explorer.html?open=%2Fdownloads%2F', { redirect: 'manual' });
  assert.equal(guest.status, 302);
  assert.equal(guest.headers.get('location'), '/?login=1&open=%2Fdownloads%2F');
  for (const url of ['/downloads/', '/protected-rules.json', '/api/session']) {
    assert.equal((await request(url)).status, 401, url);
  }
  for (const url of ['/explorer-view.html', '/.env', '/.env.example']) assert.equal((await request(url)).status, 404, url);
  assert.equal((await login('incorrect')).status, 401);
  const access = await login('@Endevour01');
  assert.equal(access.status, 200);
  const { csrf } = await access.json();
  const headers = { Cookie: access.headers.get('set-cookie').split(';')[0], 'X-SHEFiles-CSRF': csrf };
  assert.match(await (await request('/explorer.html', { headers })).text(), /id="explorerView"/);
  assert.match(await (await request('/', { headers })).text(), /Centro de descargas/);
  assert.match(await (await request('/downloads/', { headers })).text(), /data-shefiles-listing/);
  assert.equal((await request('/api/file?path=protected-rules.json', { headers })).status, 200);
  assert.equal((await request('/api/logout', { method: 'POST', headers })).status, 200);
  assert.equal((await request('/api/session', { headers })).status, 401);
});

test('manifests and downloads retain their public URLs, bytes, and range support', async t => {
  const { request, manifest } = await setup(t);
  const config = await (await request('/download-center.json')).json();
  assert.equal(config.pms, '/downloads/SHE.Endevour.json');
  assert.equal(await (await request(config.pms)).text(), manifest);
  const direct = await request('/downloads/pms.zip', { headers: { Range: 'bytes=0-3' } });
  assert.equal(direct.status, 206);
  assert.equal(await direct.text(), 'test');
  const shared = await request('/?download=%2Fdownloads%2FSHE.Endevour.json');
  assert.match(shared.headers.get('content-disposition'), /^attachment/);
  assert.equal(await shared.text(), manifest);
});

test('a configured explorer password replaces the initial password', async t => {
  const password = 'test rotation example';
  const masterDigest = createHash('sha256').update(password).digest('hex');
  const { login } = await setup(t, { masterDigest });
  assert.equal((await login('@Endevour01')).status, 401);
  assert.equal((await login(password)).status, 200);
});

test('the explorer reads and saves settings in the mounted configuration directory', async t => {
  const configDir = await mkdtemp(path.join(tmpdir(), 'shefiles-config-'));
  t.after(() => rm(configDir, { recursive: true, force: true }));
  const filename = 'protected-rules.json';
  const file = path.join(configDir, filename);
  await writeFile(file, '[]');
  const { request, login } = await setup(t, { configDir });
  const session = await login('@Endevour01');
  assert.equal(session.status, 200);
  const { csrf } = await session.json();
  const headers = {
    Cookie: session.headers.get('set-cookie').split(';')[0],
    'Content-Type': 'application/json',
    'X-SHEFiles-CSRF': csrf
  };
  assert.equal(await (await request('/' + filename, { headers })).text(), '[]');
  const { revision } = await (await request('/api/file?path=' + filename, { headers })).json();
  const content = JSON.stringify([{ prefix: 'Draft.', hidden: true }]);
  const result = await request('/api/file', {
    method: 'PUT', headers, body: JSON.stringify({ path: filename, content, revision })
  });
  assert.equal(result.status, 200);
  assert.equal(await readFile(file, 'utf8'), content);
});
