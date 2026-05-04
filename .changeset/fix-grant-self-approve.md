---
'@openape/nuxt-auth-idp': patch
---

Fix grant approval bypass: agents could self-approve their own grants regardless of approver policy.

`approve.post.ts` previously had an `isRequester` short-circuit that let any caller approve a grant whose `requester === bearer.sub`. An agent armed with only its 1h IdP token could therefore mint authz_jwt for arbitrary audiences without the human owner ever being involved — defeating the entire DDISA delegation model.

The handler now resolves the approver policy correctly per the User type convention (`approver === undefined` means "owner, or self when there is no owner"):

- explicit approver set → only that approver (or owner) may approve
- approver unset, owner set → owner is the implicit approver (sub-user / agent path)
- approver unset, owner unset → top-level human, self-approval is implicit

Surfaced in the security audit on 2026-05-04.
