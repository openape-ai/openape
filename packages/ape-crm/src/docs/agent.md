# ape-crm — agent reference

CLI over the crm.openape.ai API. Auth comes from the shared `apes login`
session; there is no separate login. Add `--json` to every command for
machine-readable output.

## Identity

```bash
ape-crm whoami --json      # { "email": "...", "act": "human", "endpoint": "..." }
```

`401` means no session on this device — the human has to run `apes login <email>` once.

## Selecting a workspace

All data commands need a workspace. Resolution order: `--workspace <id>` →
the default stored by `ape-crm workspaces use <id>` → error `400 No workspace`.

```bash
ape-crm workspaces list --json      # [{ id, name, role }]
ape-crm workspaces new --name "…" --json
ape-crm workspaces use <id>
```

## Deals

```bash
ape-crm deals list --json                     # [{ id, title, value_cents, phase, stufe, contact_name, org_name, … }]
ape-crm deals list --phase deal --stufe angebot --json
ape-crm deals new --title "…" --value 18000 --phase lead --stufe kalt --contact <id> --org <id> --json
ape-crm deals move <id> gewonnen --json
ape-crm deals rm <id>
```

- `--value` is euros; the API stores `value_cents`.
- Stufe keys are fixed — read them with `ape-crm stages --json`
  (`[{ phase, key, name }]`). `gewonnen` on a deal moves it to phase `kunde`.
  Without `--phase`/`--stufe`, a new deal lands in `lead` / `kalt`.
- A moved deal lands at the end of its new column. Reordering inside a column is
  a web-app gesture and has no CLI command.

## Contacts and organizations

```bash
ape-crm contacts list --json                                  # [{ id, name, email, phone, org_id, org_name }]
ape-crm contacts new --name "…" --email "…" --org <id> --json
ape-crm contacts orgs --json                                  # [{ id, name, domain }]
ape-crm contacts orgs --name "…" --domain "…" --json
```

## Notes

```bash
ape-crm note add <deal-id> "text" --json
ape-crm note list <deal-id> --json    # newest first, [{ id, body, author_email, created_at }]
```

## Errors

| Status | Meaning |
|---|---|
| 400 | Missing or malformed argument (`workspace_id required`, `unknown stage`, …) |
| 401 | No valid session — run `apes login <email>` |
| 403 | Role too low for this action (invites need manager or owner) |
| 404 | Unknown id, or you are not a member of that workspace |
| 410 | Invite expired, revoked or exhausted |

Timestamps are unix milliseconds. IDs are ULIDs.
