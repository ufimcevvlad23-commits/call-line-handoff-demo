#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

# Mask first so the package cannot start a public SIP listener during installation.
systemctl mask asterisk.service
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends asterisk
systemctl stop asterisk.service || true
systemctl disable asterisk.service || true
systemctl mask asterisk.service
install -d -m 0750 /etc/asterisk/callbridge-staged
install -m 0640 deploy/asterisk/pjsip_callbridge.conf.example /etc/asterisk/callbridge-staged/
install -m 0640 deploy/asterisk/extensions_callbridge.conf.example /etc/asterisk/callbridge-staged/
install -m 0640 deploy/asterisk/manager_callbridge.conf.example /etc/asterisk/callbridge-staged/
echo "Asterisk installed and masked. Staged configuration is in /etc/asterisk/callbridge-staged."
