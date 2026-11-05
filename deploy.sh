#!/usr/bin/env bash
# Intake — deploy / first-run script. Run it on the server, from the repository folder.
#
# Usage:
#   First install : bash deploy.sh --init   (checks Docker, creates .env with generated secrets)
#   Update        : bash deploy.sh          (backup, pull, build, restart, health check)
#
# The app runs in Docker (see docker-compose.yml): dependencies, build and database
# migrations happen inside the image and at startup, so the server only needs git and Docker.
# Data lives in the "intake-data" Docker volume; secrets live in .env (never in git).

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE="intake"
BRANCH="${DEPLOY_BRANCH:-main}"
BACKUP_DIR="$APP_DIR/backups"
BACKUPS_TO_KEEP=10
REQUIRED_VARS=(PUBLIC_BASE_URL GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET OWNER_EMAIL SESSION_SECRET TOKEN_ENCRYPTION_KEY)

cd "$APP_DIR"

log() { echo "==> $*"; }
warn() { echo "==> WARNING: $*" >&2; }
fail() {
  echo "==> ERROR: $*" >&2
  exit 1
}

# Value of KEY in .env (quotes stripped), empty when missing
env_value() {
  grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true
}

random_secret() {
  head -c 48 /dev/urandom | base64 | tr -d '\n'
}

check_docker() {
  command -v docker >/dev/null 2>&1 || fail "Docker is not installed. On Debian/Ubuntu: curl -fsSL https://get.docker.com | sh
  (in a Proxmox LXC container, enable Options → Features → nesting=1 first)"
  docker compose version >/dev/null 2>&1 || fail "The Docker compose plugin is missing (package docker-compose-plugin)."
  docker info >/dev/null 2>&1 || fail "Cannot talk to the Docker daemon. Is it running, and are you root or in the docker group?"
}

# ── First install ──────────────────────────────────────────────
if [[ "${1:-}" == "--init" ]]; then
  log "Intake first install — $(date)"
  check_docker
  if [[ -f .env ]]; then
    log ".env already exists, leaving it untouched."
  else
    cp .env.example .env
    chmod 600 .env
    # -i.bak works with both GNU and BSD sed
    sed -i.bak \
      -e "s|^SESSION_SECRET=.*|SESSION_SECRET=$(random_secret)|" \
      -e "s|^TOKEN_ENCRYPTION_KEY=.*|TOKEN_ENCRYPTION_KEY=$(random_secret)|" \
      -e "s|^DATA_DIR=.*|DATA_DIR=/data|" \
      .env
    rm -f .env.bak
    log "Created .env with generated SESSION_SECRET and TOKEN_ENCRYPTION_KEY."
  fi
  echo ""
  echo "Next steps:"
  echo "  1. Edit .env and fill in PUBLIC_BASE_URL (https://your-hostname), GOOGLE_CLIENT_ID,"
  echo "     GOOGLE_CLIENT_SECRET and OWNER_EMAIL:   nano .env"
  echo "  2. In Google Cloud Console add <PUBLIC_BASE_URL>/auth/callback to the OAuth client's redirect URIs."
  echo "  3. Run:   bash deploy.sh"
  exit 0
fi

# ── Update ─────────────────────────────────────────────────────
log "Intake deploy — $(date)"
check_docker

[[ -f .env ]] || fail ".env not found. Run: bash deploy.sh --init"
chmod 600 .env
for var in "${REQUIRED_VARS[@]}"; do
  [[ -n "$(env_value "$var")" ]] || fail "$var is empty in .env"
done
PUBLIC_BASE_URL="$(env_value PUBLIC_BASE_URL)"
[[ "$PUBLIC_BASE_URL" == https://* ]] || warn "PUBLIC_BASE_URL is not https: session cookies will not be marked Secure."
PORT="$(env_value PORT)"
PORT="${PORT:-3000}"

# Back up the data volume (meal plans, links, encrypted Nutrition token) while the old version runs
if docker compose ps --status running --services 2>/dev/null | grep -qx "$SERVICE"; then
  mkdir -p "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/intake-data-$(date +%Y%m%d-%H%M%S).tar.gz"
  log "Backing up data to ${BACKUP_FILE#"$APP_DIR"/}..."
  docker compose exec -T "$SERVICE" tar czf - -C /data . >"$BACKUP_FILE"
  # Keep only the most recent backups
  ls -1t "$BACKUP_DIR"/intake-data-*.tar.gz 2>/dev/null | tail -n +$((BACKUPS_TO_KEEP + 1)) | xargs -r rm -f
else
  log "App not running yet: no backup needed."
fi

# The server is deploy-only: tracked files always match origin. .env, backups/ and the data volume are not tracked.
log "Pulling latest code ($BRANCH)..."
PREVIOUS="$(git rev-parse --short HEAD)"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"
CURRENT="$(git rev-parse --short HEAD)"
if [[ "$PREVIOUS" == "$CURRENT" ]]; then
  log "Already at $CURRENT, rebuilding anyway."
else
  log "Updating $PREVIOUS → $CURRENT:"
  git --no-pager log --oneline "$PREVIOUS..$CURRENT" | sed 's/^/    /'
fi

log "Building image..."
docker compose build --pull

log "Starting container..."
docker compose up -d --remove-orphans

log "Waiting for the app to answer..."
for attempt in $(seq 1 30); do
  if docker compose exec -T "$SERVICE" wget -qO- "http://127.0.0.1:3000/api/health" >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" == 30 ]]; then
    docker compose logs --tail 50 "$SERVICE" >&2 || true
    fail "The app did not become healthy. Logs above; the previous data backup is in backups/."
  fi
  sleep 2
done

log "Removing unused images..."
docker image prune -f >/dev/null

echo ""
log "Done. Intake $CURRENT is running."
echo "    Local : http://$(hostname -I | awk '{print $1}'):$PORT"
echo "    Public: $PUBLIC_BASE_URL"
echo "    First time? Open the public URL, sign in with Google and connect Nutrition once."
