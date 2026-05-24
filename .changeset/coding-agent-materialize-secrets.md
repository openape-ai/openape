---
"@openape/apes": patch
---

fix(agents code): materialize sealed capability secrets before forge calls

`apes agents code` shells out to `gh`/`az`, which need their token in the
environment. The capability broker seals e.g. GH_TOKEN and the nest drops
the blob in `~/.config/openape/secrets.d/`, but nothing opened it for the
coding command — so `gh` ran unauthenticated and `gh issue list` returned
an empty result that the poll silently read as "no open issues". The
command now calls `materializeSecrets()` at startup (it runs as the agent
user, so the blobs + X25519 key are readable) to inject the tokens into
its env, which propagates to the gated forge CLIs. The poll also now
checks gh's exit code and detects the unauthenticated case explicitly
instead of treating an empty list as "nothing to do".
