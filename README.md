# SHEFiles

AegiPulse file explorer with light/dark themes, a recent-access home, public release downloads, file/folder visibility rules, and a master-key JSON editor. The existing `/downloads/` directory and release manifests remain the source of truth.

## Public download center and protected explorer

`/` always displays the PMS, POS and API download cards, including when a session is active. Each card fetches the manifest configured in `download-center.json` and uses its current `DownloadUrl`. A relative download URL is resolved against its manifest URL. The explorer is opened from **Abrir explorador** and the password is checked by the existing Node server. Serve the whole site through Node so the explorer view, directory indexes and explorer settings are protected on the server.

Existing public links continue to work:

- `/downloads/App/manifest.json`: raw JSON, without a password gate.
- `/downloads/App/release.zip`: direct public download.
- `/?open=%2Fdownloads%2FApp%2F`: opens the landing and prompts for the password before entering that folder.
- `/?download=%2Fdownloads%2FApp%2Frelease.zip`: download link.

## Home and navigation

After sign-in, **Inicio** inside the explorer keeps the recent folders and downloads. **Todos los archivos** opens the root folder. **Limpiar recientes** removes this browser's local history. **Cerrar sesión** returns to the public landing.

The desktop sidebar expands folders without navigating and highlights the current folder and its ancestors. Mobile provides **Inicio** and **Todos los archivos** controls in the header. Desktop list rows are 64 px in the standard state; grid cards have compact padding and maintain 44 px action targets.

## File and folder visibility

The initial explorer password is `@Endevour01`. An authenticated session opens the explorer as administrator, including visibility settings. Existing `SHE.` and `Meridian.` rules and keys are retained. A legacy rule without `target` applies to both files and folders.

Open an item's **Detalles** button, then **Ocultar carpeta/archivo** or **Mostrar carpeta/archivo**. The server saves the visibility rule with a backup.

Settings opens the **Prefijos y reglas** editor. Add/remove a prefix, choose **Solo carpetas**, **Solo archivos**, or **Carpetas y archivos**, and use its **Ocultar** checkbox to enable/disable it. These edits remain drafts until **Guardar en servidor** or **Exportar JSON**. Individual path rules have a separate expandable section. The **JSON** tab preserves the raw editor for keys and advanced metadata.

Rules accept the original array format or an object containing `rules`; unknown metadata is retained. `target` accepts `folders`, `files`, or `both` (the default). An exact item path overrides a prefix, and a file path matches only that file. An item's own prefix is evaluated before inherited ancestor rules, so an individually public folder can still contain independently hidden prefixed files. Longer ancestor paths override shorter ones:

```json
[
  { "prefix": "ExistingPrefix.", "key": "existing-folder-key", "target": "both" },
  { "prefix": "Internal.", "target": "files", "hidden": true },
  { "path": "/downloads/PrivateApp/", "hidden": true, "key": "folder-key" },
  { "path": "/downloads/ExistingPrefix.Public/", "hidden": false },
  { "path": "/downloads/release.json", "hidden": true }
]
```

`keyHash` can hold a SHA-256 hex digest instead of `key`. The UI imports any legacy `booksFolder` visibility setting when present.

Visibility rules are explorer preferences. Directory indexes and the editor require an authenticated session. A file URL remains public so existing clients can fetch manifests and releases.

## Docker deployment

See the [Spanish deployment guide](DESPLIEGUE.md) for Docker, the existing Nginx Proxy Manager and Cloudflare Tunnel, and the private password file.

## Run directly on the host

Use the existing Node server with Node.js 22 or newer. It has no npm runtime dependencies. Keep the application directory and password file outside any Nginx static document root.

1. Copy `.env.example` to a private environment file such as `/etc/shefiles/shefiles.env`, outside the static document root. Configure `SHEFILES_DOWNLOADS_DIR` with the **existing** download directory, set `SHEFILES_PUBLIC_ORIGIN=https://files.endevour.mx`, and choose a private `SHEFILES_MASTER_KEY`. On Linux, restrict the file to mode 600 and make it readable by the service user. If an earlier static deployment served its `.env` publicly, remove it from that directory and rotate the exposed credentials.
2. Start Node using `SHEFILES_ENV_FILE=/etc/shefiles/shefiles.env node server.mjs` from the application directory. Use your service manager for persistent operation. Use a free `PORT` (the example uses 3011). If Nginx runs on the host, bind to `127.0.0.1`. If Nginx Proxy Manager runs in Docker on the existing `proxy` network, use that network's host bridge address as `SHEFILES_HOST` and as the Proxy Host upstream. The host bridge address is available with `docker network inspect proxy --format '{{(index .IPAM.Config 0).Gateway}}'`. Keep the upstream port internal.
3. Keep the existing Tunnel route and update only the upstream for `files.endevour.mx`. Forward the entire hostname, including `/downloads/`, to Node and disable **Cache Assets**. Remove any location that still serves the old static explorer or directory listing. Check the landing, login and a public manifest before switching traffic. If a previous edge-cache rule served the static explorer, bypass caching for this hostname and purge its old URLs.

To change the password over SSH, edit `SHEFILES_MASTER_KEY` in the private environment file and restart the service. The restart invalidates existing sessions. A value supplied by the service manager takes precedence over the application's `.env`.

### Verify the proxy

Request `/api/capabilities` first at the Node address and then at the public hostname. Both should return JSON containing `"service":"shefiles"`. If Node returns JSON but the public hostname returns an Nginx HTML page, update the Proxy Host's upstream or remove the custom location that intercepts `/api/`. After switching the hostname, unauthenticated requests to `/.env` and `/explorer-view.html` should return 404, and `/downloads/` should return 401. An existing manifest URL under `/downloads/` should still return 200.

The editor can update the known app configuration files and existing `.json` files within the configured release directory. File details offer **Editar JSON**. Other file types, outside paths, dotfiles, and outside symlink targets are rejected. Writes require a 30-minute HttpOnly/SameSite session, a CSRF token, valid JSON, and a current content revision. Failed validation or conflicts leave the file untouched. The backend writes a private backup before replacing each JSON and serializes saves per file to reject competing updates.

Backups must live **outside both public roots**; the server rejects a private directory inside either root. To restore one, stop writes, copy the `.bak` file to its original JSON path, then refresh. Direct downloads support HEAD, byte ranges, and ETags. Node's [filesystem documentation](https://nodejs.org/api/fs.html) describes the rename and path-resolution primitives used by the adapter.

## Checks

```powershell
npm run check
npm test
```

The tests use temporary releases and verify the landing, session gate, configurable password, public manifests, and byte-range downloads.
