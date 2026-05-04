---
'@openape/nuxt-auth-idp': patch
'@openape/auth': patch
---

Bundle of free-idp hardening fixes from the 2026-05-04 audit (closes #292, #293, #294, #295, #296).

- **#292**: extend `RE_AUTH_PATHS` rate-limit regex to cover `/api/{enroll,register,my-agents,push,users}` — paths that were uncapped for brute-force attacks.
- **#293**: defence-in-depth in `apps/openape-free-idp/server/api/test/session.post.ts` — additional `NODE_ENV !== 'production'` gate, plus `crypto.timingSafeEqual` instead of `!==` on the management-token compare.
- **#294**: `enroll.post.ts` derives agent emails with an 8-hex-char hash of the canonical owner email, eliminating the dot-collapse / sanitise collisions where `foo@example.com` and `foo@example_com` mapped to the same agent suffix.
- **#295**: `my-agents/[id].patch.ts` now validates the new SSH key BEFORE deleting old ones, then saves and prunes — agent is never without an authenticator on validation failure. Plus 1000-char length cap and explicit-shape check on the public key. `SshKeyStore.deleteAllForUser` gains an `exceptKeyId` option for the rotate-in-place flow; backwards-compatible (option is optional).
- **#296**: `push/subscribe.post.ts` rejects with 409 when the endpoint URL is already registered to a different account, and removes `userEmail` from the conflict-update SET clause. Closes the subscription-hijack path.
