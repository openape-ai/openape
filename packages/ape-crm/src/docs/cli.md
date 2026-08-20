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
ape-crm deals --stage proposal             # one column
ape-crm deals new --title "Website" --value 18000 --stage lead
ape-crm deals move 01J…  won               # change the stage
ape-crm deals rm 01J…                      # delete deal and its notes
```

Values are given in euros and stored as cents.

## Stages

```bash
ape-crm stages                             # key, name and outcome per column
```

Each workspace has its own pipeline; rename, reorder, add and delete columns in
the web app. A deal carries the stage **key**, so renaming a column leaves every
deal where it is. A stage whose outcome is `won` or `lost` stamps the closing
date — a workspace can hold several of each, e.g. "Verloren – Preis" and
"Verloren – Timing". New workspaces start with `lead`, `qualified`, `proposal`,
`won`, `lost`.

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
