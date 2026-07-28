# @openape/ape-troop

Owner CLI for [troop.openape.ai](https://troop.openape.ai) — manage the devices
(nests) bound to your account and the agents running on them. Authenticates via
the shared `apes login` SSO session (no separate login).

## Install

```bash
npm i -g @openape/ape-troop
apes login you@example.com   # shared OpenApe SSO — covers ape-troop too
```

## Commands

```bash
ape-troop nests bind <display-name> [--pod-uuid <uuid>] [--json]  # bind a device, mint its host_id + device_secret
ape-troop nests list [--json]                                     # list bound devices
ape-troop nests remove <host-id>                                  # revoke a binding (soft)

ape-troop agents list [--json]                                    # agents on this troop
ape-troop agents spawn <host-id> <name>                           # spawn an agent on a nest (DDISA-approved)
ape-troop agents destroy <agent-id>
ape-troop agents pause|resume <name>                              # pause or resume an agent by name

ape-troop nests pause|resume <host-id>                            # pause or resume all agents on a nest
ape-troop whoami                                                  # current OpenApe identity
```

`login` / `logout` are stubs — all OpenApe CLIs share one session; use
`apes login` / `apes logout`. `ape-troop logout` only clears the cached troop
SP-token.
