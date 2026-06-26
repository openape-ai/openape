---
"@openape/apes": patch
---

fix(cli): `apes agents list` works off-Linux (IdP is the source of truth)

The agent list comes from the IdP (`/api/my-agents`) and works anywhere the
user is logged in, but the command also annotated each row with local OS-user
state via the Linux-only `getHostPlatform()`, so the whole listing failed on
macOS with "unsupported host platform". The OS-USER/HOME cross-reference is a
nest concern — it now only runs on a Linux nest host; off-nest the command
prints the IdP-sourced NAME/EMAIL/ACTIVE columns.
