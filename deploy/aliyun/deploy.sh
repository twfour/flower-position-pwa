#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/flower-position-pwa}"
DATA_DIR="${DATA_DIR:-/var/lib/flower-position}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/flower-position}"
ENV_FILE="${ENV_FILE:-/etc/flower-position.env}"
SSH_TARGET="${SSH_TARGET:-root@101.37.82.5}"
SSH_KEY_FILE="${SSH_KEY_FILE:-$HOME/.ssh/flower_position_aliyun_ed25519}"
PASSWORD_FILE="${PASSWORD_FILE:-aliyun.txt}"
ARCHIVE_REMOTE="${ARCHIVE_REMOTE:-/tmp/flower-position-pwa.tar.gz}"
HEALTH_URL="${HEALTH_URL:-http://101.37.82.5/api/health}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_ARCHIVE="$(mktemp -t flower-position-pwa.XXXXXX.tar.gz)"

cleanup() {
  rm -f "$TMP_ARCHIVE"
}
trap cleanup EXIT

has_password_auth() {
  [[ -f "$ROOT_DIR/$PASSWORD_FILE" ]] && command -v expect >/dev/null 2>&1
}

has_key_auth() {
  [[ -f "$SSH_KEY_FILE" ]]
}

remote_exec() {
  local remote_cmd="$1"
  if has_key_auth; then
    ssh -i "$SSH_KEY_FILE" -o StrictHostKeyChecking=no "$SSH_TARGET" "$remote_cmd"
  elif has_password_auth; then
    expect -f - "$SSH_TARGET" "$ROOT_DIR/$PASSWORD_FILE" "$remote_cmd" <<'EXPECT'
set timeout 180
set target [lindex $argv 0]
set password_file [lindex $argv 1]
set remote_cmd [lindex $argv 2]
set f [open $password_file r]
set pw [string trim [read $f]]
close $f
spawn ssh -o StrictHostKeyChecking=no $target $remote_cmd
expect {
  "password:" {
    send -- "$pw\r"
    exp_continue
  }
  eof {
    catch wait result
    exit [lindex $result 3]
  }
  timeout {
    exit 124
  }
}
EXPECT
  else
    ssh -o StrictHostKeyChecking=no "$SSH_TARGET" "$remote_cmd"
  fi
}

copy_to_remote() {
  local local_path="$1"
  local remote_path="$2"
  if has_key_auth; then
    scp -i "$SSH_KEY_FILE" -o StrictHostKeyChecking=no "$local_path" "$SSH_TARGET:$remote_path"
  elif has_password_auth; then
    expect -f - "$SSH_TARGET" "$ROOT_DIR/$PASSWORD_FILE" "$local_path" "$remote_path" <<'EXPECT'
set timeout 180
set target [lindex $argv 0]
set password_file [lindex $argv 1]
set local_path [lindex $argv 2]
set remote_path [lindex $argv 3]
set f [open $password_file r]
set pw [string trim [read $f]]
close $f
spawn scp -o StrictHostKeyChecking=no $local_path $target:$remote_path
expect {
  "password:" {
    send -- "$pw\r"
    exp_continue
  }
  eof {
    catch wait result
    exit [lindex $result 3]
  }
  timeout {
    exit 124
  }
}
EXPECT
  else
    scp -o StrictHostKeyChecking=no "$local_path" "$SSH_TARGET:$remote_path"
  fi
}

echo "==> Packaging project"
(
  cd "$ROOT_DIR"
  LC_ALL=C tar \
    --exclude ".git" \
    --exclude ".DS_Store" \
    --exclude "aliyun.txt" \
    --exclude "data" \
    --exclude "__pycache__" \
    --exclude "*.pyc" \
    -czf "$TMP_ARCHIVE" .
)

echo "==> Uploading archive to $SSH_TARGET"
copy_to_remote "$TMP_ARCHIVE" "$ARCHIVE_REMOTE"

echo "==> Installing files and restarting services"
remote_exec "set -e
mkdir -p '$APP_DIR' '$DATA_DIR' '$BACKUP_DIR'
tar -xzf '$ARCHIVE_REMOTE' -C '$APP_DIR'
rm -f '$ARCHIVE_REMOTE'
if [ ! -f '$ENV_FILE' ]; then
  cat > '$ENV_FILE' <<'ENV'
DATA_DIR=/var/lib/flower-position
PORT=8000
HOST=127.0.0.1
PLANTNET_API_KEY=CHANGE_ME
PLANTNET_PROJECT=all
ENV
  chmod 600 '$ENV_FILE'
fi
cp '$APP_DIR/deploy/aliyun/flower-position.service' /etc/systemd/system/
cp '$APP_DIR/deploy/aliyun/flower-position-backup.service' /etc/systemd/system/
cp '$APP_DIR/deploy/aliyun/flower-position-backup.timer' /etc/systemd/system/
cp '$APP_DIR/deploy/aliyun/nginx.conf' /etc/nginx/conf.d/flower-position.conf
systemctl daemon-reload
systemctl enable --now flower-position.service
systemctl restart flower-position.service
systemctl enable --now flower-position-backup.timer
nginx -t
systemctl reload nginx
curl -fsS http://127.0.0.1:8000/api/health >/dev/null
systemctl --no-pager --lines=0 status flower-position.service >/dev/null"

echo "==> Checking public health endpoint"
curl -fsS "$HEALTH_URL"
echo
echo "Deploy complete."
