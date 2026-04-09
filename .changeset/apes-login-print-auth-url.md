---
'@openape/apes': patch
---

fix(apes): always print auth URL in `apes login --browser`

The PKCE browser flow now always prints the authorization URL to stdout so users can copy/paste it manually when a browser cannot be opened automatically — SSH sessions, containers, CI runners, or restricted-user shells (e.g. `su - <user>` on macOS). Opening the browser via `open`/`xdg-open`/`start` remains a best-effort convenience.
