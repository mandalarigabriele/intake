# Deployment

Intake runs as a single Docker container in an LXC container on Proxmox, exposed through Cloudflare Tunnel and Nginx Proxy Manager:

```
Browser → Cloudflare Tunnel → Nginx Proxy Manager → <lxc-ip>:3000 (intake container)
```

`deploy.sh` handles both the first install and updates. The server only needs git and Docker: dependencies, build and database migrations happen inside the image and at startup.

## LXC container requirements

- Debian or Ubuntu, 1 vCPU, 1 GB RAM and 8 GB disk are plenty.
- Docker inside LXC needs **Options → Features → nesting=1** (and `keyctl=1` for unprivileged containers).
- Install Docker and the compose plugin:
  ```sh
  curl -fsSL https://get.docker.com | sh
  ```

## First install

1. Clone the private repository (an SSH deploy key or a fine-grained read-only token works well):
   ```sh
   git clone git@github.com:<owner>/intake.git /opt/intake && cd /opt/intake
   ```
2. Create `.env` with generated secrets:
   ```sh
   bash deploy.sh --init
   ```
3. Fill in the remaining values (`nano .env`):
   - `PUBLIC_BASE_URL`: the public https URL, without a trailing slash
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OWNER_EMAIL`
4. In Google Cloud Console add `<PUBLIC_BASE_URL>/auth/callback` to the OAuth client's authorized redirect URIs (see [google-sign-in.md](google-sign-in.md)). The localhost one can stay for development.
5. Build and start:
   ```sh
   bash deploy.sh
   ```
6. **Nginx Proxy Manager** → Proxy Hosts → Add:
   - Domain: the public hostname; scheme `http`; forward hostname: the LXC IP; forward port `3000`
   - *Block common exploits* on; websockets are not needed
7. **Cloudflare Tunnel** → Public hostname → the same hostname, with the service pointing to Nginx Proxy Manager.
8. Open the public URL, sign in with Google and connect Nutrition once. Intake registers itself again for the production redirect URL; the local development connection is separate.
9. On iPhone: open the URL in Safari → Share → *Add to Home Screen*.

## Update

```sh
cd /opt/intake && bash deploy.sh
```

The script:

1. checks Docker and the required `.env` values;
2. backs up the data volume to `backups/` (the last 10 are kept);
3. fetches `origin/main` and resets the working tree to it. The server is deploy-only: `.env`, `backups/` and the data volume are untracked and untouched;
4. rebuilds the image, restarts the container and waits for `/api/health`, printing the logs if the app does not come up;
5. removes unused images.

Set `DEPLOY_BRANCH=<branch>` to deploy another branch, e.g. for a test.

## Data and backups

The `intake-data` Docker volume holds the SQLite database (meal plans and their history, plan↔meal links) and the encrypted Nutrition token. Nutrition data itself lives on the Nutrition MCP server.

Back up `.env` together with `backups/`. To restore a backup:

```sh
docker compose stop intake
docker run --rm -v intake_intake-data:/data -v "$PWD/backups":/backups alpine \
  sh -c 'rm -rf /data/* && tar xzf /backups/<file>.tar.gz -C /data && chown -R 1000:1000 /data'
docker compose start intake
```

Losing the volume only means connecting Nutrition again and re-uploading the current meal plan.

## Health check

`GET /api/health` returns `{"status":"ok"}`. Docker compose uses it as the container health check, and `deploy.sh` waits for it after every update.
