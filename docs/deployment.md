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

## Automatic deploy (GitHub Actions)

Every merge to `main` deploys by itself:

1. **CI** (`.github/workflows/ci.yml`, GitHub-hosted) runs typecheck, tests and build on every pull request and every push to `main`.
2. **Deploy** (`.github/workflows/deploy.yml`) starts when CI succeeds on a push to `main` and runs on a **self-hosted runner inside the LXC container**. It calls `sudo -n /usr/bin/bash /opt/intake/deploy.sh`, so the deploy is exactly the manual one (backup, pull, build, restart, health check). It can also be started by hand from the Actions tab (*Run workflow*).

The runner only makes outbound connections to GitHub: no port is opened and Cloudflare Tunnel is not involved. The repository is private, so no fork pull request can reach the runner.

### Runner setup (once, on the container, as root)

```sh
# 1. A dedicated user without a password, allowed to run only deploy.sh as root
useradd --create-home --shell /bin/bash github-runner
echo 'github-runner ALL=(root) NOPASSWD: /usr/bin/bash /opt/intake/deploy.sh' > /etc/sudoers.d/intake-deploy
chmod 440 /etc/sudoers.d/intake-deploy
visudo -cf /etc/sudoers.d/intake-deploy        # expected: "parsed OK"

# 2. Download the runner (take the current version and checksum from the GitHub page in step 3)
su - github-runner
mkdir actions-runner && cd actions-runner
curl -fsSLo runner.tar.gz https://github.com/actions/runner/releases/download/v<VERSION>/actions-runner-linux-x64-<VERSION>.tar.gz
tar xzf runner.tar.gz

# 3. Register it: GitHub → repository → Settings → Actions → Runners → New self-hosted runner (Linux x64)
#    shows a one-time token. Paste it only here, on the server.
./config.sh --url https://github.com/<owner>/intake --labels intake --name intake-lxc --unattended --token <TOKEN>
exit

# 4. Install and start it as a service that runs as github-runner
cd /home/github-runner/actions-runner
./svc.sh install github-runner
./svc.sh start
./svc.sh status                                 # expected: "active (running)"
```

The runner appears as **Idle** under Settings → Actions → Runners. To remove it: `./svc.sh stop && ./svc.sh uninstall`, then `su - github-runner -c "cd actions-runner && ./config.sh remove --token <TOKEN>"`.

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
