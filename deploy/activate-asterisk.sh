#!/bin/sh
set -eu

APP_DIR=/opt/skorozvon-bitrix-call-bridge
ENV_FILE="$APP_DIR/.env.production"
ACCESS_FILE=/root/callbridge-sip-access.json
BACKUP_ROOT=/var/backups/skorozvon-call-bridge-asterisk
STAGE_DIR=$(mktemp -d)
OVERLAY_PATH=$(mktemp)
trap 'rm -rf "$STAGE_DIR" "$OVERLAY_PATH"' EXIT

test -f "$ENV_FILE" || { echo "Missing $ENV_FILE" >&2; exit 1; }
test -n "${SIP_PUBLIC_IP:-}" || { echo "Run with SIP_PUBLIC_IP=x.x.x.x" >&2; exit 1; }

SIP_PUBLIC_IP="$SIP_PUBLIC_IP" node --env-file="$ENV_FILE" "$APP_DIR/deploy/bootstrap-sip-secrets.mjs" "$OVERLAY_PATH" "$ACCESS_FILE"
node "$APP_DIR/deploy/merge-env.mjs" "$ENV_FILE" "$OVERLAY_PATH"
node --env-file="$ENV_FILE" "$APP_DIR/deploy/render-asterisk.mjs" "$STAGE_DIR"

BACKUP_DIR="$BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 "$BACKUP_DIR"
for file in pjsip.conf extensions.conf manager.conf pjsip_callbridge.conf extensions_callbridge.conf callbridge-cdr.env; do
  test ! -e "/etc/asterisk/$file" || cp -a "/etc/asterisk/$file" "$BACKUP_DIR/"
done

grep -qxF '#include "pjsip_callbridge.conf"' /etc/asterisk/pjsip.conf || printf '\n#include "pjsip_callbridge.conf"\n' >> /etc/asterisk/pjsip.conf
grep -qxF '#include "extensions_callbridge.conf"' /etc/asterisk/extensions.conf || printf '\n#include "extensions_callbridge.conf"\n' >> /etc/asterisk/extensions.conf

install -o root -g asterisk -m 0640 "$STAGE_DIR/pjsip_callbridge.conf" /etc/asterisk/pjsip_callbridge.conf
install -o root -g asterisk -m 0640 "$STAGE_DIR/extensions_callbridge.conf" /etc/asterisk/extensions_callbridge.conf
install -d -o root -g asterisk -m 0750 /etc/asterisk/manager.d /etc/nftables.d
install -o root -g asterisk -m 0640 "$STAGE_DIR/manager_callbridge.conf" /etc/asterisk/manager.d/callbridge.conf
install -o root -g asterisk -m 0640 "$STAGE_DIR/callbridge-cdr.env" /etc/asterisk/callbridge-cdr.env
install -o root -g root -m 0755 "$APP_DIR/scripts/asterisk-cdr-agi.mjs" /usr/share/asterisk/agi-bin/callbridge-cdr-agi.mjs
install -o root -g root -m 0644 "$APP_DIR/deploy/callbridge-sip.nft" /etc/nftables.d/callbridge-sip.nft
install -o root -g root -m 0644 "$APP_DIR/deploy/callbridge-sip-firewall.service" /etc/systemd/system/callbridge-sip-firewall.service

if ! nft list table inet callbridge_sip >/dev/null 2>&1; then
  nft -c -f /etc/nftables.d/callbridge-sip.nft
fi
systemctl daemon-reload
systemctl enable callbridge-sip-firewall.service
systemctl restart callbridge-sip-firewall.service
systemctl unmask asterisk.service
systemctl daemon-reload
systemctl enable --now asterisk.service
systemctl restart skorozvon-call-bridge.service

ATTEMPT=0
until systemctl is-active --quiet asterisk.service && asterisk -rx 'core show uptime' >/dev/null 2>&1; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ "$ATTEMPT" -ge 15 ]; then
    systemctl --no-pager --full status asterisk.service >&2 || true
    journalctl -u asterisk.service -n 80 --no-pager >&2 || true
    exit 1
  fi
  sleep 1
done

asterisk -rx 'dialplan show from-skorozvon-callbridge' >/dev/null
asterisk -rx 'dialplan show callbridge-customer' >/dev/null
asterisk -rx 'manager show user callbridge' >/dev/null
echo "Asterisk is active. Provider SIP is restricted; manager calling remains disabled until SIP registration and an answered caller ID are verified."
