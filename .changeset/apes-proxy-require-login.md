---
"@openape/apes": patch
---

apes: `apes proxy --` requires `apes login` first

Removes the silent fallback to transparent mode when no `~/.config/apes/auth.json`
is present. That fallback shipped in the same minor that introduced
IdP-mediation (M3) and was UX-dishonest: the UI on `id.openape.ai/agents/<email>`
suggests YOLO + Allow/Deny rules apply, but a not-logged-in proxy ignored
them all and just transparently let everything through. Worst kind of bug
for a security-relevant feature — looks like it works, doesn't.

Now `apes proxy --` exits with code **77** (EX_NOPERM) and a clear message:

```
apes proxy requires `apes login` first.

Without a login the proxy has no agent identity to attribute grant
requests to, so the YOLO / Allow / Deny policy on id.openape.ai cannot
apply. Run:

  apes login

and re-run `apes proxy -- ...`.
```

Tightening: anyone scripting around `apes proxy --` who relied on the silent
transparent fallback now gets a hard fail. That's intentional — the security
posture promised by the UI requires identity.
