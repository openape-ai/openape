---
'@openape/apes': patch
---

Async mode (`ape-shell -c` / `apes run` without `--wait`) now reports the real grant status: a grant the IdP auto-approved at creation (standing grants, YOLO) prints a short "approved automatically" confirmation with the execute command instead of the false "pending approval" block with approve URL and waiting protocol. Exit code stays 75 (unchanged).
