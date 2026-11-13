# Deployment

Intake runs as a Docker container on **`dockerdmz`**, a shared Docker host (Proxmox LXC) in the DMZ VLAN that hosts all the publicly exposed apps, each in its own folder under `/opt/<app>` with its own `docker-compose.yml`. Internal-only services live on a separate Docker host in the internal VLAN: never deploy a public app there.

Cloudflare Tunnel sends traffic straight to the container's published port, without Nginx Proxy Manager:

```
Browser → Cloudflare Tunnel → <dockerdmz-ip>:3000 (intake container)
```

The tunnel's published application points at an IP address, so `dockerdmz` must keep a static IP. If the app moves to another host, update the **Service URL in Cloudflare** (Zero Trust → Networks → Tunnels → the tunnel → Published applications).

`deploy.sh` handles both the first install and updates. The server only needs git and Docker: dependencies, build and database migrations happen inside the image and at startup.

## Docker host requirements

- Debian 13, unprivileged LXC with **Options → Features → nesting=1, keyctl=1**, network on the DMZ VLAN with a static IP.
- Intake itself needs about 1 vCPU, 1 GB RAM and 8 GB disk; size the shared host for all the apps it runs.
- Install Docker and the compose plugin, then check that the storage driver is `overlay2` or `overlayfs` (not `vfs`):
  ```sh
  curl -fsSL https://get.docker.com | sh
  docker info | grep "Storage Driver"
  ```
- Port `3000` on the host belongs to Intake; other apps on the same host use other ports.

## First install

1. Clone the private repository with its own SSH deploy key. A deploy key works for one repository only, so on a shared host give it a dedicated file name and tell git to use it for this repository:
   ```sh
   ssh-keygen -t ed25519 -N "" -C intake-server -f /root/.ssh/intake_deploy_key
   cat /root/.ssh/intake_deploy_key.pub   # GitHub → repository → Settings → Deploy keys → Add (read-only)
   ssh-keyscan github.com >> /root/.ssh/known_hosts
   GIT_SSH_COMMAND="ssh -i /root/.ssh/intake_deploy_key -o IdentitiesOnly=yes" \
     git clone git@github.com:<owner>/intake.git /opt/intake && cd /opt/intake
   git config core.sshCommand "ssh -i /root/.ssh/intake_deploy_key -o IdentitiesOnly=yes"
   ```
   `core.sshCommand` is stored in `.git/config`, so it survives the `git reset --hard` that `deploy.sh` runs.
2. Create `.env` with generated secrets:
   ```sh
   bash deploy.sh --init
   ```
3. Fill in the remaining values (`nano .env`):
   - `PUBLIC_BASE_URL`: the public https URL, without a trailing slash
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OWNER_EMAIL`
   - optional `HEVY_API_KEY` (Hevy Pro → Settings → Developer) to show workouts; add it later at any time and run `bash deploy.sh` again
4. In Google Cloud Console add `<PUBLIC_BASE_URL>/auth/callback` to the OAuth client's authorized redirect URIs (see [google-sign-in.md](google-sign-in.md)). The localhost one can stay for development.
5. Build and start:
   ```sh
   bash deploy.sh
   ```
6. **Cloudflare Tunnel** → Published applications → Add: the public hostname, with Service URL `http://<dockerdmz-ip>:3000`.
7. Optional, for access from the LAN by name: a Nginx Proxy Manager proxy host pointing to `<dockerdmz-ip>:3000`. Public traffic does not go through it.
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
2. **Deploy** (`.github/workflows/deploy.yml`) starts when CI succeeds on a push to `main` and runs on a **self-hosted runner on the Docker host** (`dockerdmz-intake`, label `intake`). It calls `sudo -n /usr/bin/bash /opt/intake/deploy.sh`, so the deploy is exactly the manual one (backup, pull, build, restart, health check). It can also be started by hand from the Actions tab (*Run workflow*).
3. **Release** (job `release` in the same workflow, GitHub-hosted) runs after a successful deploy: it tags the deployed commit with the next version and publishes a GitHub release whose notes list the merged pull requests. Versions start at `v0.1.0` and every deploy increases the patch number (`v0.1.1`, `v0.1.2`, …). For a bigger step, start the Deploy workflow by hand and choose `minor` or `major`. A deploy of a commit that is already tagged creates no new release.

The runner only makes outbound connections to GitHub: no port is opened and Cloudflare Tunnel is not involved. The repository is private, so no fork pull request can reach the runner.

### Runner setup (once, on the Docker host, as root)

A runner registered on a private personal repository serves that repository only, so the shared host runs one runner per app, all as the same `github-runner` user, each in its own folder (`actions-runner-intake`, `actions-runner-<app>`, …).

```sh
# 1. A dedicated user without a password, allowed to run only deploy.sh as root
#    (skip useradd if another app's runner already created the user)
useradd --create-home --shell /bin/bash github-runner
echo 'github-runner ALL=(root) NOPASSWD: /usr/bin/bash /opt/intake/deploy.sh' > /etc/sudoers.d/intake-deploy
chmod 440 /etc/sudoers.d/intake-deploy
visudo -cf /etc/sudoers.d/intake-deploy        # expected: "parsed OK"

# 2. Download the runner (take the current version and checksum from the GitHub page in step 3)
su - github-runner
mkdir actions-runner-intake && cd actions-runner-intake
curl -fsSLo runner.tar.gz https://github.com/actions/runner/releases/download/v<VERSION>/actions-runner-linux-x64-<VERSION>.tar.gz
tar xzf runner.tar.gz

# 3. Register it: GitHub → repository → Settings → Actions → Runners → New self-hosted runner (Linux x64)
#    shows a one-time token. Paste it only here, on the server.
./config.sh --url https://github.com/<owner>/intake --labels intake --name dockerdmz-intake --unattended --token <TOKEN>
exit

# 4. Install and start it as a service that runs as github-runner
cd /home/github-runner/actions-runner-intake
./svc.sh install github-runner
./svc.sh start
./svc.sh status                                 # expected: "active (running)"
```

The runner appears as **Idle** under Settings → Actions → Runners. To remove it: `./svc.sh stop && ./svc.sh uninstall`, then `su - github-runner -c "cd actions-runner-intake && ./config.sh remove --token <TOKEN>"`. If the host is already gone, use **Force remove** on the runner's page in GitHub instead.

## Moving to another host

The steps used to move Intake from its old dedicated LXC to `dockerdmz`. Downtime is a few minutes, between steps 3 and 5.

1. **New host**: install Docker (see above), copy `/opt/intake` from the old host (`rsync -a /opt/intake/ root@<new-ip>:/opt/intake/`, which brings `.env` and `backups/`), copy the deploy key to `/root/.ssh/intake_deploy_key`, set `core.sshCommand` as in *First install* and check `git fetch origin`.
2. **New host**, still no downtime: build the image and create the volume without starting the app:
   ```sh
   cd /opt/intake && docker compose build --pull && docker compose up --no-start
   ```
3. **Old host**: stop the app and export the volume:
   ```sh
   cd /opt/intake && docker compose stop
   docker run --rm -v intake_intake-data:/data -v /root:/backup alpine tar czf /backup/intake-migr.tar.gz -C /data .
   scp /root/intake-migr.tar.gz root@<new-ip>:/root/
   ```
4. **New host**: import the volume and start:
   ```sh
   docker run --rm -v intake_intake-data:/data -v /root:/backup alpine \
     sh -c 'tar xzf /backup/intake-migr.tar.gz -C /data && chown -R 1000:1000 /data'
   cd /opt/intake && docker compose up -d && docker compose exec intake wget -qO- http://127.0.0.1:3000/api/health
   ```
   The logs should show `Nutrition account connected`.
5. **Cloudflare**: point the tunnel's Service URL to `http://<new-ip>:3000` and check the public URL.
6. **Runner**: shut down the old host, force-remove its runner in GitHub, set up a new one on the new host (see *Runner setup*) and start the Deploy workflow by hand to check it.

Keep the folder path `/opt/intake`: the compose project name, and so the volume name `intake_intake-data`, comes from it, and the sudoers rule names it too. To roll back before step 6, point Cloudflare back to the old host and run `docker compose start` there.

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

## Apple Health automatic upload

Health Auto Export on the iPhone posts to `<PUBLIC_BASE_URL>/api/health/ingest`, outside Google sign-in, with the token shown in
Profile › Apple Health › automatic sync ("Sincronizzazione automatica") (see [apple-health.md](apple-health.md#ingest-automatic-upload)).
Nothing is needed on the server: the token is generated in the app and stored encrypted in the database.

If the public hostname is protected by **Cloudflare Access**, the iPhone cannot pass the Access login, so add a bypass for that path only:

1. Zero Trust → Access → Applications → Add an application → Self-hosted.
2. Application domain: the public hostname, path `api/health/ingest`.
3. Policy: action **Bypass**, include **Everyone**.

Access matches the most specific path first, so the rest of the app keeps its current protection; the endpoint itself refuses any
request without the token.
