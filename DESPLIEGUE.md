# Desplegar SHEFiles con Docker

Este despliegue conecta SHEFiles a la red Docker `proxy` que ya usa Nginx Proxy Manager. Cloudflare Tunnel sigue entrando por Nginx. El puerto 3000 es interno al contenedor y no se publica en el servidor.

## 1. Prepará los archivos en el servidor

Subí el proyecto actualizado, incluido `Dockerfile`, `compose.yaml` y `.dockerignore`, a un directorio que Nginx no publique como sitio estático. Los comandos de esta guía se ejecutan por SSH desde ese directorio.

Conservá tu carpeta de descargas actual. Subí el archivo `.env` preparado al lado de `compose.yaml`. Incluye estos valores.

```dotenv
SHEFILES_DOWNLOADS_HOST=/home/she/files/downloads
SHEFILES_PUBLIC_ORIGIN=https://files.endevour.mx
SHEFILES_SECRET_FILE=/etc/shefiles/shefiles.env
```

Comprobá que `/home/she/files/downloads` sea la carpeta que ya contiene `SHE.Endevour.json`, `SHE.EndevourPOS.json`, `SHE.EndevourAPI.json` y los instaladores. Si están en otra carpeta, cambiá solo `SHEFILES_DOWNLOADS_HOST`. Compose rechaza una ruta inexistente en lugar de crear una carpeta vacía. Si tenés cambios en `protected-rules.json` o `explorer-config.json` en el sitio anterior, copiá esos JSON al proyecto antes del primer arranque para que se usen al inicializar el volumen de configuración.

## 2. Guardá la clave fuera de la carpeta pública

Subí el archivo privado `shefiles.env` a tu directorio personal por SFTP. Para instalarlo como clave inicial o reemplazar deliberadamente la anterior, ejecutá:

```bash
sudo install -d -m 700 /etc/shefiles
sudo install -m 600 "$HOME/shefiles.env" /etc/shefiles/shefiles.env
rm -- "$HOME/shefiles.env"
```

El archivo preparado ya contiene `SHEFILES_MASTER_KEY`. Consultá su valor en tu copia local para iniciar sesión. Si ya tenés un archivo privado con una clave vigente y preferís conservarla, omití la instalación y confirmá que `SHEFILES_SECRET_FILE` apunte a ese archivo. Retirá de la carpeta estática cualquier `.env` anterior que haya quedado publicado.

## 3. Arrancá y verificá el contenedor

```bash
docker network inspect proxy --format '{{range .Containers}}{{println .Name}}{{end}}'
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

El primer comando debe listar el contenedor de Nginx Proxy Manager. SHEFiles debería aparecer como `healthy` después de la comprobación de arranque.

Verificá el DNS interno, la API y un manifiesto antes de cambiar el proxy.

```bash
docker compose exec -T shefiles node -e "fetch('http://shefiles-endevour:3000/api/capabilities').then(async r => { if (!r.ok) throw Error(r.status); console.log(await r.json()); })"
docker compose exec -T shefiles node -e "fetch('http://shefiles-endevour:3000/downloads/SHE.Endevour.json',{method:'HEAD'}).then(r=>{if(!r.ok)throw Error(r.status); console.log('Manifest:',r.status)})"
```

Esperá `service: 'shefiles'` y `Manifest: 200`. Si el contenedor no arranca, revisá `docker compose logs --tail=80 shefiles`.

## 4. Actualizá el Proxy Host existente

En Nginx Proxy Manager, editá el host de `files.endevour.mx` con estos valores:

| Opción | Valor |
| --- | --- |
| Scheme | `http` |
| Forward Hostname / IP | `shefiles-endevour` |
| Forward Port | `3000` |
| Cache Assets | Desactivado |

Retirá las ubicaciones personalizadas de ese host que todavía sirvan la carpeta estática o intercepten `/`, `/api/` o `/downloads/`. Conservá el túnel y el hostname público. Si Cloudflare guardó recursos del sitio anterior, configurá **Bypass cache** para `http.host eq "files.endevour.mx"` y purgá ese hostname. [Reglas de caché](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/) · [Purga por hostname](https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-hostname/)

## 5. Comprobá el sitio público

```bash
curl -fsS https://files.endevour.mx/api/capabilities
curl -fsSI https://files.endevour.mx/downloads/SHE.Endevour.json
curl -sSI https://files.endevour.mx/.env
curl -sSI https://files.endevour.mx/downloads/
```

La API debe devolver JSON de SHEFiles, el manifiesto debe dar **200**, `/.env` debe dar **404** y el listado anónimo de `/downloads/` debe dar **401**. Abrí la landing y comprobá el acceso con **Abrir explorador**.

## Actualizaciones y cambio de clave

- Para actualizar, subí los cambios a la misma carpeta y ejecutá `docker compose up -d --build`. Las descargas quedan en la carpeta existente. Los ajustes editables y respaldos se guardan en volúmenes persistentes. Evitá `docker compose down -v`, que eliminaría esos volúmenes.
- Para cambiar la clave, editá el archivo privado y ejecutá `docker compose up -d --force-recreate shefiles`. Las sesiones anteriores se cierran.
