---
"@openape/apes-openclaw": patch
---

Fix three ways the generated agent could be set up wrong:

- The identity mount was read-only all the way down, so `@openape/cli-auth`
  died with `EROFS` writing the exchanged SP token into `sp-tokens/` — the
  first authenticated call from the sandbox failed. `sp-tokens/` now gets a
  writable overlay while `auth.json` stays immutable.
- The enrolment key was never mounted, so once the agent token expired
  challenge-response refresh had nothing to sign with.
- Setup enabled elevated exec without checking that `openape-grant-gate` is
  installed. OpenClaw ignores a `plugins.entries` record for a missing plugin,
  which would have left the agent with a host escape and no gate. Setup now
  refuses unless the plugin is loadable, and restarts the gateway so the
  patched plugin config is actually live before success is reported.
