#!/bin/sh
set -eu

ARCHIVE_PATH=${1:?release archive is required}
OVERLAY_PATH=${2:?env overlay is required}
APP_DIR=/opt/skorozvon-bitrix-call-bridge
BACKUP_DIR=/var/backups/skorozvon-call-bridge-code
STAGE_DIR=$(mktemp -d)
trap 'rm -rf "$STAGE_DIR" "$ARCHIVE_PATH" "$OVERLAY_PATH"' EXIT

mkdir -p "$APP_DIR" "$BACKUP_DIR"
tar -xzf "$ARCHIVE_PATH" -C "$STAGE_DIR"
(cd "$STAGE_DIR" && npm test)

if [ -d "$APP_DIR" ]; then
  BACKUP_PATH="$BACKUP_DIR/release-$(date -u +%Y%m%dT%H%M%SZ).tgz"
  tar --exclude=.env.production --exclude=var --exclude=.git -czf "$BACKUP_PATH" -C "$APP_DIR" .
fi

tar -cf - -C "$STAGE_DIR" . | tar -xf - -C "$APP_DIR"
node "$APP_DIR/deploy/merge-env.mjs" "$APP_DIR/.env.production" "$OVERLAY_PATH"
sh "$APP_DIR/deploy/install-or-upgrade.sh"
echo "Release installed; Asterisk and real calls were not enabled."
