#!/usr/bin/env bash
# Installs or updates Crumena on a Linux server that already runs Caddy. Run as root:
#   bash <(curl -fsSL https://raw.githubusercontent.com/phoenix-2203/crumena/main/deploy/setup.sh)
# Optional: a different DuckDNS name, e.g.  ... setup.sh) mycrumena
#
# What it does: clones or updates /opt/crumena, builds the app, makes the relayer's own throwaway
# testnet account on this server (its phrase stays in /opt/crumena/server/.env, readable by the
# service only, and is never printed), runs the relayer as a locked-down system service on
# 127.0.0.1:8790, and points Caddy at it. Other sites on this server are left alone: the Caddy
# config is checked before reloading, and the change is undone if the check fails.
set -euo pipefail
NAME="${1:-crumena}"
DOMAIN="${NAME%.duckdns.org}.duckdns.org"
DIR=/opt/crumena
SITE=/etc/caddy/crumena.caddy
MAIN=/etc/caddy/Caddyfile

[ "$(uname -s)" = "Linux" ] || { echo "Log in to the server first (ssh), then run this there."; exit 1; }
[ "$(id -u)" = "0" ] || { echo "Run this as root on the server (for example: sudo -i, then run it again)."; exit 1; }
command -v caddy >/dev/null || { echo "Caddy isn't installed. See https://caddyserver.com/docs/install"; exit 1; }
[ -f "$MAIN" ] || { echo "No $MAIN found. Is Caddy set up as a system service?"; exit 1; }
command -v node >/dev/null || { echo "Node.js 22+ is needed: https://nodejs.org"; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || { echo "Node.js 22+ is needed (for --env-file-if-exists)"; exit 1; }

id crumena >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin crumena
if [ ! -d "$DIR/.git" ]; then
  git clone https://github.com/phoenix-2203/crumena "$DIR"
else
  # The folder belongs to the service user; let root's git update it.
  git config --global --get-all safe.directory | grep -qxF "$DIR" || git config --global --add safe.directory "$DIR"
  git -C "$DIR" pull --ff-only
fi

echo "Building…"
cd "$DIR"
PNPM="npx -y pnpm@10"
command -v pnpm >/dev/null && PNPM=pnpm
$PNPM install --frozen-lockfile
$PNPM --filter @crumena/app build
chown -R crumena:crumena "$DIR"

echo "Relayer account (a throwaway made here, for gas only)…"
RELAYER=$(cd "$DIR/server" && sudo -u crumena node --import tsx scripts/new-relayer.ts)

install -m 644 "$DIR/deploy/crumena.service" /etc/systemd/system/crumena.service
systemctl daemon-reload
systemctl enable --now crumena
systemctl restart crumena

echo "Configuring Caddy for https://$DOMAIN …"
sed "s/^crumena\.duckdns\.org {/$DOMAIN {/" "$DIR/deploy/Caddyfile" > "$SITE"
cp "$MAIN" "$MAIN.bak-crumena"
grep -qxF "import $SITE" "$MAIN" || printf '\nimport %s\n' "$SITE" >> "$MAIN"
if ! caddy validate --config "$MAIN" --adapter caddyfile >/dev/null 2>&1; then
  cp "$MAIN.bak-crumena" "$MAIN"
  echo "Caddy rejected the new config, so nothing was changed. Details:"
  caddy validate --config "$MAIN" --adapter caddyfile || true
  exit 1
fi
systemctl reload caddy

echo
echo "Done. Crumena is at https://$DOMAIN (the HTTPS certificate can take a minute the first time)."
echo "Fund the relayer with test QOR and fUSD from the faucet (it pays gas and the demo's 50 fUSD):"
echo "  $RELAYER"
echo "Logs: journalctl -u crumena -f      To update later, run this script again."
