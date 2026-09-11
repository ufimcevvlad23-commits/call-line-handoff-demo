import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const outputDirectory = process.argv[2];
if (!outputDirectory) throw new Error("Usage: node deploy/render-asterisk.mjs <output-directory>");

function required(name, pattern = /^[^\r\n;]+$/) {
  const value = String(process.env[name] || "");
  if (!value || !pattern.test(value)) throw new Error(`Некорректный или отсутствующий ${name}`);
  return value;
}

const publicIp = required("SIP_PUBLIC_IP", /^(?:\d{1,3}\.){3}\d{1,3}$/);
const skorozvonUser = required("SKOROZVON_SIP_USERNAME", /^[a-zA-Z0-9_.-]{4,64}$/);
const skorozvonPassword = required("SKOROZVON_SIP_PASSWORD", /^[a-zA-Z0-9_-]{24,128}$/);
const managerUser = required("MANAGER_SIP_USERNAME", /^[a-zA-Z0-9_.-]{4,64}$/);
const managerPassword = required("MANAGER_SIP_PASSWORD", /^[a-zA-Z0-9_-]{24,128}$/);
const amiUsername = required("ASTERISK_AMI_USERNAME", /^[a-zA-Z0-9_.-]{3,64}$/);
const amiSecret = required("ASTERISK_AMI_SECRET", /^[a-zA-Z0-9_-]{24,128}$/);
const cdrSecret = required("PBX_CDR_SECRET", /^[a-zA-Z0-9_-]{24,128}$/);
const beelineHost = required("BEELINE_SIP_HOST", /^[a-zA-Z0-9.-]+$/);
const beelinePort = Number(process.env.BEELINE_SIP_PORT || 5060);
if (!Number.isInteger(beelinePort) || beelinePort < 1 || beelinePort > 65535) throw new Error("Некорректный BEELINE_SIP_PORT");

const pjsip = `[global]
type=global
user_agent=CallBridge
endpoint_identifier_order=ip,auth_username,username

[transport-beeline]
type=transport
protocol=udp
bind=0.0.0.0:5060
external_signaling_address=${publicIp}
external_media_address=${publicIp}
local_net=127.0.0.0/8
tos=cs3
cos=3

[transport-callbridge-users]
type=transport
protocol=udp
bind=0.0.0.0:5070
external_signaling_address=${publicIp}
external_media_address=${publicIp}
local_net=127.0.0.0/8
tos=cs3
cos=3

[skorozvon-callbridge-auth]
type=auth
auth_type=userpass
username=${skorozvonUser}
password=${skorozvonPassword}
realm=${publicIp}

[skorozvon-callbridge-aor]
type=aor
max_contacts=5
remove_existing=yes
qualify_frequency=60

[skorozvon-callbridge]
type=endpoint
transport=transport-callbridge-users
context=from-skorozvon-callbridge
disallow=all
allow=alaw,ulaw
auth=skorozvon-callbridge-auth
aors=skorozvon-callbridge-aor
identify_by=auth_username,username
direct_media=no
force_rport=yes
rewrite_contact=yes
rtp_symmetric=yes

[${managerUser}-auth]
type=auth
auth_type=userpass
username=${managerUser}
password=${managerPassword}
realm=${publicIp}

[${managerUser}-aor]
type=aor
max_contacts=3
remove_existing=yes
qualify_frequency=60

[${managerUser}]
type=endpoint
transport=transport-callbridge-users
context=from-manager-callbridge
disallow=all
allow=alaw,ulaw
auth=${managerUser}-auth
aors=${managerUser}-aor
identify_by=auth_username,username
direct_media=no
force_rport=yes
rewrite_contact=yes
rtp_symmetric=yes

[beeline-trunk-1]
type=endpoint
transport=transport-beeline
context=from-beeline-callbridge
disallow=all
allow=alaw,ulaw
aors=beeline-trunk-1-aor
direct_media=no
force_rport=yes
rewrite_contact=yes
rtp_symmetric=yes
send_pai=yes
send_rpid=yes
trust_id_inbound=yes
trust_id_outbound=yes
from_domain=${beelineHost}

[beeline-trunk-1-aor]
type=aor
contact=sip:${beelineHost}:${beelinePort}
qualify_frequency=0

[beeline-trunk-1-identify]
type=identify
endpoint=beeline-trunk-1
match=62.105.135.81
match=62.105.132.84
`;

const extensions = `[callbridge-set-cid]
exten => s,1,Set(CALLERID(num)=\${ARG1})
 same => n,Set(PJSIP_HEADER(add,P-Asserted-Identity)=<sip:\${ARG1}@${publicIp}>)
 same => n,Set(PJSIP_HEADER(add,X-CallBridge-Call-ID)=\${ARG2})
 same => n,Return()

[callbridge-send-cdr]
exten => s,1,NoOp(Sending Call Bridge CDR)
 same => n,AGI(callbridge-cdr-agi.mjs,\${UNIQUEID},\${CB_CALL_ID},\${CHANNEL(linkedid)},\${CB_CLIENT_PHONE},\${CB_REQUESTED_CID},\${CB_DISPOSITION})
 same => n,Return()

[callbridge-customer]
exten => _X!,1,NoOp(Call Bridge \${CB_CALL_ID}: manager answered, calling customer)
 same => n,Set(CB_CLIENT_PHONE=\${FILTER(0-9,\${EXTEN})})
 same => n,GotoIf($[\${LEN(\${CB_CLIENT_PHONE})}=11]?valid:blocked)
 same => n(valid),GotoIf($[\${LEN(\${CB_CALLER_ID})}=11]?caller_ok:blocked)
 same => n(caller_ok),GotoIf($[\${LEN(\${CB_TRUNK_ENDPOINT})}>0]?route_ok:blocked)
 same => n(route_ok),Set(CB_REQUESTED_CID=\${CB_CALLER_ID})
 same => n,Set(CALLERID(num)=\${CB_REQUESTED_CID})
 same => n,Dial(PJSIP/\${CB_CLIENT_PHONE}@\${CB_TRUNK_ENDPOINT},45,b(callbridge-set-cid^s^1(\${CB_REQUESTED_CID}^\${CB_CALL_ID})))
 same => n,Set(CB_DISPOSITION=\${IF($["\${DIALSTATUS}"="ANSWER"]?ANSWERED:\${DIALSTATUS})})
 same => n,Gosub(callbridge-send-cdr,s,1)
 same => n,Hangup()
 same => n(blocked),NoOp(Blocked: required manager-call routing value is invalid)
 same => n,Hangup(21)

[from-skorozvon-callbridge]
exten => _X!,1,NoOp(Authenticated Skorozvon outbound call)
 same => n,Set(CB_CLIENT_PHONE=\${FILTER(0-9,\${EXTEN})})
 same => n,Set(CB_REQUESTED_CID=\${FILTER(0-9,\${CALLERID(num)})})
 same => n,Set(CB_CALL_ID=\${FILTER(0-9a-zA-Z_,\${PJSIP_HEADER(read,X-Skorozvon-Call-ID)})})
 same => n,GotoIf($[\${LEN(\${CB_CLIENT_PHONE})}=11]?client_ok:blocked)
 same => n(client_ok),GotoIf($[\${LEN(\${CB_REQUESTED_CID})}=11]?caller_ok:blocked)
 same => n(caller_ok),Set(CB_TRUNK_ENDPOINT=\${DB(callbridge-caller-route/\${CB_REQUESTED_CID})})
 same => n,ExecIf($["\${CB_TRUNK_ENDPOINT}"=""]?Set(CB_TRUNK_ENDPOINT=beeline-trunk-1))
 same => n,Set(CALLERID(num)=\${CB_REQUESTED_CID})
 same => n,Dial(PJSIP/\${CB_CLIENT_PHONE}@\${CB_TRUNK_ENDPOINT},45,b(callbridge-set-cid^s^1(\${CB_REQUESTED_CID}^\${CB_CALL_ID})))
 same => n,Set(CB_DISPOSITION=\${IF($["\${DIALSTATUS}"="ANSWER"]?ANSWERED:\${DIALSTATUS})})
 same => n,Gosub(callbridge-send-cdr,s,1)
 same => n,Hangup()
 same => n(blocked),NoOp(Blocked malformed destination or Caller ID from Skorozvon)
 same => n,Hangup(21)

[from-manager-callbridge]
exten => *43,1,Answer()
 same => n,Echo()
 same => n,Hangup()
exten => _X!,1,NoOp(Direct manager outbound dialing is disabled; use signed Bitrix button)
 same => n,Hangup(21)

[from-beeline-callbridge]
exten => _X!,1,NoOp(Inbound PSTN routing is closed until a destination policy is approved)
 same => n,Hangup(21)
`;

const manager = `[general]
enabled = yes
webenabled = no
port = 5038
bindaddr = 127.0.0.1

[${amiUsername}]
secret = ${amiSecret}
read = call,reporting,cdr
write = call,originate
permit = 127.0.0.1/255.255.255.255
`;

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(join(outputDirectory, "pjsip_callbridge.conf"), pjsip, { mode: 0o640 }),
  writeFile(join(outputDirectory, "extensions_callbridge.conf"), extensions, { mode: 0o640 }),
  writeFile(join(outputDirectory, "manager_callbridge.conf"), manager, { mode: 0o640 }),
  writeFile(join(outputDirectory, "callbridge-cdr.env"), `CALLBRIDGE_CDR_URL=http://127.0.0.1:8790/api/pbx-cdr\nPBX_CDR_SECRET=${cdrSecret}\n`, { mode: 0o640 })
]);
console.log(JSON.stringify({ ok: true, outputDirectory, sipPorts: [5060, 5070], ami: "127.0.0.1:5038" }));
