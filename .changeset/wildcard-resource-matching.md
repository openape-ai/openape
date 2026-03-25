---
"@openape/shapes": minor
"@openape/core": minor
"@openape/apes": minor
---

Support wildcard resource matching for capability grants. A shorter granted resource chain now covers longer required chains (prefix matching), and `apes run` checks for existing capability grants before creating new exact-command grants.
