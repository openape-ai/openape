# Fixed SSH inventory

`resources` accepts `assignSsh` with the current Pod revision, resource epoch and
`target: {alias, jumps, profile: "linde-server-v1"}`. Jump aliases are ordered
outermost first; at most two are supported. Native setup resolves the owner's
SSH aliases. The stored assignment pins resolved hosts/users/ports, identity-file
paths, known-hosts digests and the packaged observation profile digest. Changing
any of these requires reassignment. Assignment pauses the Pod and advances its
resource epoch; ordinary resource revocation cancels active work.

The exact generated `tool.ssh_ID.read` capability must be in the script manifest.
`context.tools.invoke({sshInventory: resourceId})` accepts no additional fields.
It returns `{version:1,profile,facts}` or throws a bounded collection error.
Synthetic validation deliberately has no server observations; scripts must
represent that absence without inventing successful evidence.

The broker authorizes the reviewed binding through the existing DDISA structured
command grant path (`pod-ssh.inventory`, action `read`). Adapter and argv checks,
Pod identity, target and active grant checks remain mandatory. This uses Grants
sections 3.5, 3.6 and 6 without changing the protocol. The native process guardian
owns SSH and its jump processes. Cancellation, resource changes, grant revocation,
45-second deadline and 128-KiB output ceiling stop execution. Domain records stay
in the run directory for recovery; temporary connection configurations are removed.

Scripts never receive private keys, raw SSH options or shell command text. The
broker generates a separate configuration with strict existing host-key checks,
no agent forwarding, no local commands, no connection multiplexing, no port
forwarding and only the pinned identities. The existing script sandbox and generic
HTTPS/program network rules are unchanged. Encrypted keys that require an SSH
agent are currently unsupported and fail explicitly.

The versioned Linde profile reads OS/kernel/packages, cached APT candidates,
apt-daily completion, selected systemd services, root disk usage, public certificate
metadata, the documented backup marker and two fixed localhost health URLs. It
requires noninteractive sudo and Python 3. It never refreshes packages, restarts
services, renews certificates, deploys or reads application secret configuration.
Certificate evidence describes stored files, not an external TLS handshake.

The certificate observation reads `fullchain.pem` in the fixed live certificate directory. Linde's lego renewal updates that file; the adjacent legacy `cert.pem` can remain expired. This still does not prove which certificate an external client receives.

## Reporting recipe

`examples/linde-server-report.mjs` is a single complete Pod script. Assign five
SSH resources, Reports GET/POST with a narrowly bound series-publisher identity,
Telegram POST and the verified Delta Mind bot secret. Set nonsecret variables:
`inventory_targets` (JSON mapping the five aliases to resource IDs),
`reports_series_id`, `telegram_chat_id` (verified personal recipient), and
`delivery_mode` (`preview` or `live`). Secrets are `telegram_bot_token` and the
Reports publisher private key assigned through HTTP DDISA authentication.

Preview writes a private report envelope to the Pod workspace. Live mode freezes
the report and publication key in its checkpoint, verifies the returned digest
and private report URL, then sends the link. It preserves publication receipts
when notification fails. Stable effect keys use the existing effect ledger;
unknown deliveries require owner reconciliation and cannot automatically resend.
Healthy and partially observed runs both produce German technical prose reports.
Confirmed report and notification delivery completes the run even when the
report records observation gaps. Those gaps remain committed claims. Delivery
failure still blocks completion and requires recovery before another attempt.
The former one-node sequence workflow with `0 8 * * 1,4` in `Europe/Vienna` was
archived with the other workflows (issue 1455, M4); rebuild the schedule as a
network source or the Pod's own schedule. Only enable it after an installed live
report and notification have been verified.
