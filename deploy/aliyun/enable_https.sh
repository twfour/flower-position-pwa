#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/flower-position-pwa}"
DOMAIN="${DOMAIN:-flower.qinyibin.com}"
ALT_DOMAIN="${ALT_DOMAIN:-}"
CERT_DIR="${CERT_DIR:-/etc/nginx/ssl/$DOMAIN}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/conf.d/flower-position.conf}"
SSH_TARGET="${SSH_TARGET:-root@101.37.82.5}"
SSH_KEY_FILE="${SSH_KEY_FILE:-$HOME/.ssh/flower_position_aliyun_ed25519}"

ssh_exec() {
  ssh -i "$SSH_KEY_FILE" -o StrictHostKeyChecking=no -o BatchMode=yes "$SSH_TARGET" "$1"
}

TOKEN=""

cleanup() {
  if [[ -n "$TOKEN" && -f "$SSH_KEY_FILE" ]]; then
    ssh_exec "rm -f '$APP_DIR/.well-known/acme-challenge/$TOKEN'" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

require_key() {
  if [[ ! -f "$SSH_KEY_FILE" ]]; then
    echo "SSH key not found: $SSH_KEY_FILE" >&2
    exit 1
  fi
}

echo "==> Checking SSH key"
require_key

echo "==> Preparing ACME webroot on server"
TOKEN="flower-position-https-check-$(date +%s)"
ssh_exec "set -e
mkdir -p '$APP_DIR/.well-known/acme-challenge'
printf '$TOKEN' > '$APP_DIR/.well-known/acme-challenge/$TOKEN'"

echo "==> Checking ACME challenge over public HTTP"
if [[ "$(curl -fsS "http://$DOMAIN/.well-known/acme-challenge/$TOKEN" 2>/dev/null || true)" != "$TOKEN" ]]; then
  echo "HTTP challenge is not reachable for $DOMAIN." >&2
  echo "If this is an Aliyun mainland ECS, wait until ICP filing is approved." >&2
  exit 1
fi

if [[ -n "$ALT_DOMAIN" ]]; then
  if [[ "$(curl -fsS "http://$ALT_DOMAIN/.well-known/acme-challenge/$TOKEN" 2>/dev/null || true)" != "$TOKEN" ]]; then
    echo "HTTP challenge is not reachable for $ALT_DOMAIN." >&2
    echo "Check DNS and ICP filing before issuing HTTPS certificates." >&2
    exit 1
  fi
fi

echo "==> Issuing certificate with acme.sh"
ssh_exec "set -e
if [ ! -x /root/.acme.sh/acme.sh ]; then
  echo 'acme.sh is not installed at /root/.acme.sh/acme.sh' >&2
  exit 1
fi
if [ -n '$ALT_DOMAIN' ]; then
  /root/.acme.sh/acme.sh --issue -d '$DOMAIN' -d '$ALT_DOMAIN' -w '$APP_DIR' --keylength ec-256
else
  /root/.acme.sh/acme.sh --issue -d '$DOMAIN' -w '$APP_DIR' --keylength ec-256
fi"

echo "==> Installing certificate"
ssh_exec "set -e
mkdir -p '$CERT_DIR'
/root/.acme.sh/acme.sh --install-cert -d '$DOMAIN' --ecc \
  --key-file '$CERT_DIR/privkey.pem' \
  --fullchain-file '$CERT_DIR/fullchain.pem' \
  --reloadcmd 'systemctl reload nginx'"

echo "==> Enabling HTTPS nginx config"
ssh_exec "set -e
cp '$APP_DIR/deploy/aliyun/nginx-https.conf' '$NGINX_CONF'
nginx -t
systemctl reload nginx"

echo "==> Checking HTTPS"
curl -fsS "https://$DOMAIN/api/health"
echo
if [[ -n "$ALT_DOMAIN" ]]; then
  curl -fsS "https://$ALT_DOMAIN/api/health"
  echo
fi
echo "HTTPS enabled."
