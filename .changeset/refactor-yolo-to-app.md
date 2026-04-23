---
'@openape/nuxt-auth-idp': minor
'@openape/core': patch
---

Extract YOLO-mode from `@openape/nuxt-auth-idp` to `openape-free-idp`; module exposes a generic `definePreApprovalHook` seam instead.

**Module changes (nuxt-auth-idp):**
- **NEW** `definePreApprovalHook(hook)` + `runPreApprovalHooks(event, request)` — a generic seam apps can use to auto-approve grant requests. Hooks run AFTER standing-grant evaluation; the first non-null match wins. Return `{ kind, decidedBy }` to approve, `null` to defer to the manual flow.
- **REMOVED** YOLO-specific files: `yolo-policy-store.ts`, `yolo-policy-auth.ts`, `grant-auto-approval.ts`, `api/users/[email]/yolo-policy.{get,put,delete}.ts`. The module is now YOLO-agnostic.
- **REMOVED** `defineYoloPolicyStore` / `yoloPolicyStore` from the public store surface.
- The module's runtime `/grants` page now renders `auto_approval_kind` as a generic badge (was: hardcoded YOLO/Standing match).

**Core change:**
- `OpenApeGrant.auto_approval_kind` widened from `'standing' | 'yolo'` to `string` so consuming apps can register custom kinds via the hook. Both previously-defined values remain valid; pure type-widen, no runtime impact.

**Consumer migration** (applied in this PR for openape-free-idp):
- Apps that relied on `defineYoloPolicyStore` should now register the YOLO feature in their own `server/` tree and call `definePreApprovalHook` from a Nitro plugin.
