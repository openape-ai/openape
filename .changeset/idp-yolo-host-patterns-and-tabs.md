---
"openape-free-idp": minor
---

idp: web-YOLO actually evaluates + per-bucket UI tabs

**Web YOLO was inert.** The `yolo-evaluator` early-returned `null` whenever
the grant request had no `command` array. Web grants (audience `ape-proxy`)
arrive with `target_host` and no command, so every Web YOLO attempt fell
through to human approval — the UI lied.

Evaluator now accepts a generic `target` string (joined command for
Commands/Root, `target_host` for Web) and globs deny-patterns against it
the same way for both shapes. New `targetFromRequest()` helper picks the
right field; the pre-approval hook calls it. 4 new tests cover Web/host
patterns + host fallback to wildcard.

UI changes on `/agents/:email`:

- **Tabs instead of stacked cards** — Commands / Web / Root / Default each
  in its own tab. Compact at any viewport.
- **Per-bucket placeholders + helper text.** Web no longer suggests
  `rm -rf *`; it shows `*.openai.com\nstripe.com`. Commands shows
  bash-shaped patterns. Root shows root-command examples. Default is
  the catch-all.
- **Web tab carries an inline notice** that today only host-globs are
  enforceable (TLS-opaque CONNECT). Method+Path patterns for cleartext-HTTP
  are flagged as future work — no surprise lying.
- **"Erlaubte Commands" (Standing Grants list)** moved into the Commands
  tab only. Web/Root will get their own surfaces in a follow-up.
- **Authentifizierung** is no longer an accordion taking page space; it's
  a small `?`-icon popover next to the section title with the same
  `apes login` command + DDISA hint.
