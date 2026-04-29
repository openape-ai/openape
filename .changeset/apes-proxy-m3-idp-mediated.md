---
"@openape/apes": minor
---

apes: `apes proxy --` is now IdP-mediated when the caller is logged in (M3)

Closes the gap where the YOLO/Allow/Deny config on `id.openape.ai/agents/<email>`
(Web tab) had no effect on `apes proxy --` invocations. Two reasons it
previously didn't work:

1. **The ephemeral proxy never asked the IdP.** Default config used
   `default_action="allow"` with no `[[grant_required]]` rule, so unmatched
   hosts went straight through. The IdP grant flow was unreachable.
2. **Even if it had asked, the requester was synthetic.** The TOML hard-coded
   `agent_email = "ephemeral@apes-proxy.local"`, so YOLO lookups keyed on
   `(email, audience='ape-proxy')` couldn't match the user's real policy row.

Both fixed:

- `apes proxy --` now reads the cached `~/.config/apes/auth.json` (already
  populated by `apes login`). When found: `agent_email` becomes the user's
  real agent email, `idp_url` becomes the IdP they logged in against, and
  `default_action` flips to `"request"` — every unmatched egress triggers an
  IdP grant request whose pre-approval hook applies the user's YOLO policy.
- Console banner now says which mode the proxy started in:
  `[apes proxy] IdP-mediated mode — agent=…, idp=…` vs
  `[apes proxy] not logged in — transparent mode`.

Fallback for not-logged-in callers stays the M1a behavior (default-allow +
audit, no IdP roundtrip) so `apes proxy --` doesn't suddenly fail for users
who haven't run `apes login` yet — the warning tells them how to upgrade to
mediated mode.

End-to-end effect: on `id.openape.ai/agents/<email>` Web-tab, configuring
"YOLO aus + allow-list `*.openai.com`" makes `apes proxy -- curl
https://api.openai.com/...` auto-approve, while `apes proxy -- curl
https://api.github.com/...` waits for human approval. Identical UX semantics
to what the UI promises.
