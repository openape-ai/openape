# ape-kpi — CLI reference

```
ape-kpi push <key> <value>     # push a KPI (see flags below)
ape-kpi list                   # your KPIs, newest first
ape-kpi whoami                 # who the server thinks you are
ape-kpi docs [agent|cli|errors]
```

## push

| Flag | Meaning |
|---|---|
| `--scope <path>` | Grouping path (`delta-mind/mail`); default `general` |
| `--unit <u>` | Display unit (`mails`, `h`) |
| `--detail <md>` | Inline Markdown detail |
| `--detail-file <f>` | Read the Markdown detail from a file |
| `--json` | Print the stored row |

## list

| Flag | Meaning |
|---|---|
| `--latest` | Newest row per (scope, key) |
| `--scope <path>` | Prefix filter on the scope path |
| `--since <t>` | ISO date or unix ms |
| `--json` | Machine-readable |

Login happens once per device via `apes login <email>` — ape-kpi reuses that
session (`ape-kpi login` is a stub pointing there).
