# Deployment

Intake runs as a single Docker container in an LXC container on Proxmox, exposed through Cloudflare Tunnel and Nginx Proxy Manager.

## First install

1. In the LXC container, install Docker and the compose plugin.
2. Clone the private repository:
   ```sh
   git clone git@github.com:<owner>/intake.git && cd intake
   ```
3. Create the environment file from the template and fill in the values:
   ```sh
   cp .env.example .env
   chmod 600 .env
   ```
   Generate random secrets with `openssl rand -base64 48`.
4. In Google Cloud Console, add `<PUBLIC_BASE_URL>/auth/callback` as an authorized redirect URI of the OAuth client (see [google-sign-in.md](google-sign-in.md)).
5. Start the app:
   ```sh
   docker compose up -d --build
   ```
6. In Nginx Proxy Manager, add a proxy host for the public hostname pointing to `<lxc-ip>:3000`.
7. In Cloudflare Tunnel, route the public hostname to Nginx Proxy Manager.
8. Open the app, sign in with Google, then connect the Nutrition account once at `/connect/nutrition`.

## Update

```sh
git pull
docker compose up -d --build
```

## Data

The `intake-data` Docker volume holds the SQLite database and the encrypted Nutrition token. Back it up together with `.env`. Losing the volume only means reconnecting Nutrition and re-uploading meal plans; nutrition data itself lives on the Nutrition MCP server.

## Health check

`GET /api/health` returns `{"status":"ok"}`. Docker compose uses it as the container health check.
