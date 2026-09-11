#!/bin/sh
set -eu

APP_DIR=/opt/skorozvon-bitrix-call-bridge
STATE_DIR=/var/lib/skorozvon-call-bridge

test -f "$APP_DIR/.env.production" || {
  echo "Missing $APP_DIR/.env.production; refusing to start without protected configuration" >&2
  exit 1
}

id callbridge >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin callbridge
install -d -o callbridge -g callbridge -m 0750 "$STATE_DIR" "$STATE_DIR/backups"
chown -R root:callbridge "$APP_DIR"
chmod 0750 "$APP_DIR"
chmod 0640 "$APP_DIR/.env.production"

install -m 0644 "$APP_DIR/deploy/call-bridge.service" /etc/systemd/system/skorozvon-call-bridge.service
install -m 0644 "$APP_DIR/deploy/call-bridge-backup.service" /etc/systemd/system/call-bridge-backup.service
install -m 0644 "$APP_DIR/deploy/call-bridge-backup.timer" /etc/systemd/system/call-bridge-backup.timer
install -m 0644 "$APP_DIR/deploy/call-bridge-healthcheck.service" /etc/systemd/system/call-bridge-healthcheck.service
install -m 0644 "$APP_DIR/deploy/call-bridge-healthcheck.timer" /etc/systemd/system/call-bridge-healthcheck.timer

systemctl daemon-reload
systemctl enable skorozvon-call-bridge.service call-bridge-backup.timer call-bridge-healthcheck.timer
systemctl restart skorozvon-call-bridge.service
systemctl start call-bridge-backup.timer call-bridge-healthcheck.timer
HEALTH_ATTEMPT=0
until curl --fail --silent --max-time 8 http://127.0.0.1:8790/api/health; do
  HEALTH_ATTEMPT=$((HEALTH_ATTEMPT + 1))
  if [ "$HEALTH_ATTEMPT" -ge 10 ]; then
    systemctl --no-pager --full status skorozvon-call-bridge.service >&2 || true
    exit 1
  fi
  sleep 1
done
echo
echo "Call Bridge updated. CALLING_ENABLED remains controlled only by .env.production."
