# ape-crm

Deal pipeline, contacts and notes on https://crm.openape.ai — the same data the
web app shows.

## Setup

```bash
npm i -g @openape/ape-crm
apes login you@example.com     # once per device, covers every OpenApe CLI
ape-crm workspaces new --name "Delta Mind"
```

`workspaces new` also stores the new workspace as your default, so later
commands need no `--workspace`. Switch with `ape-crm workspaces use <id>`.

## Deals

```bash
ape-crm deals                              # every deal in the workspace
ape-crm deals --phase deal --stufe angebot
ape-crm deals new --title "Website" --value 18000 --phase lead --stufe kalt
ape-crm deals move 01J…  gewonnen          # stufe; endmarkers may change phase
ape-crm deals rm 01J…                      # delete deal and its notes
```

Values are given in euros and stored as cents. New deals default to phase
`lead`, stufe `kalt`.

## Stages

```bash
ape-crm stages                             # fixed keys for lead / deal / kunde
```

Pipelines are code, not per-workspace data. `gewonnen` moves a deal into
phase `kunde` / `onboarding`. `konvertiert` moves a lead into `deal` /
`inbound`.

## Contacts and organizations

```bash
ape-crm contacts                                  # people
ape-crm contacts new --name "Max Muster" --email max@muster.at --org 01J…
ape-crm contacts orgs                             # companies
ape-crm contacts orgs --name "Muster GmbH" --domain muster.at
```

## Notes

```bash
ape-crm note add 01J… "Angebot verschickt, Rückmeldung bis Freitag"
ape-crm note list 01J…
```

## Working with others

```bash
ape-crm workspaces invite 01J… --role member --days 7
ape-crm accept https://crm.openape.ai/invite?token=…
```

Every command takes `--json` for machine-readable output and `--endpoint` to
point at a different instance (or set `APE_CRM_ENDPOINT`).
