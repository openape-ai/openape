---
"@openape/apes": patch
---

fix(coding): disable credential helper on push so osxkeychain can't hang

The token-URL push authenticated fine, but on success git invoked the
inherited `credential.helper=osxkeychain` to *store* the credential,
which hangs headless (no GUI for the spawned agent user) — stalling the
run after the push. The push now runs with `-c credential.helper=`
(no helper: the token URL already authenticates, and nothing is stored),
and the clone resets the inherited helper before adding a $GH_TOKEN one
for any direct git the agent might run. Fixes runs hanging at the push
step (and the resulting pile-up of stuck git processes).
