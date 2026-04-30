---
"@openape/apes": patch
---

apes: `apes agents spawn` and `apes agents destroy` now `--wait` for the as=root grant approval

Previously the inner `apes run --as root -- bash <script>` invocation returned exit code 75 (pending) immediately after creating the grant, before the user had a chance to approve it. spawn/destroy interpreted that as a hard failure and cleaned up the scratch directory in `finally`, so the pending grant ended up pointing at a `setup.sh` / `teardown.sh` that no longer existed on disk — the approval URL was useless.

Both commands now pass `--wait` so the escapes call blocks until the grant is approved (or denied / times out) and the script has actually executed. Cleanup is safe because the grant has either run to completion or definitely won't run anymore.
