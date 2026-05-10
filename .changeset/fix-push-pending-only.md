---
'@openape/nuxt-auth-idp': minor
---

Fix backwards push-notification logic. Previously every freshly-inserted grant fired a Web Push to the approver — including grants that the YOLO/standing-grant pre-approval hook was about to auto-approve, because the pre-approval logic runs AFTER the initial grant save. Result felt inverted from the human's perspective: auto-approved grants pinged, while pending grants requesting their own attention often did not (because the human's user row has no `approver` field, so push fan-out was skipped entirely under the old "humans don't approve their own grants" assumption).

Two fixes shipped:

1. **New `defineGrantPendingHook`** extension point in the module. The `POST /api/grants` handler invokes it only on the fall-through path where the grant remains pending after every pre-approval / standing-grant / similarity check has had its say. The drizzle store no longer fires push directly from `save()`.

2. **Approver resolution** now treats the requester themselves as the recipient when no explicit `approver` row is set (the case for humans). Humans need to know about their own pending grants because they ARE their own approver in the UI.

Net effect: pushes go to the right person at the right moment.
