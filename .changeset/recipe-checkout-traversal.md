---
"@openape/apes": patch
---

Harden recipe-checkout against path traversal: reject `.`/`..`/backslash segments in a catalog subdir ref and assert the resolved source stays inside the staging clone before copying.
