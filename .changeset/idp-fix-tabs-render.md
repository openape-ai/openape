---
"openape-free-idp": patch
---

idp: fix broken tab render on `/agents/:email`

`UTabs` with `variant="link" size="sm"` rendered each tab trigger as a
narrow vertical column at the agent-detail card width — labels clipped
to 1–2 letters and per-tab content stacked simultaneously instead of
showing only the active tab's content. Replaced with a manual flex
button-row + `v-if` per tab. Same UX, no UTabs API dance.
