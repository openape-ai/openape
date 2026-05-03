---
"@openape/apes": minor
---

apes: warn when the installed version is behind latest @openape/apes on npm

Once-a-day check against `https://registry.npmjs.org/@openape/apes/latest`. If the local version is older, prints a yellow stderr warning before the command runs:

```
WARN  apes 0.21.2 is behind latest @openape/apes@0.22.0. Run `npm i -g @openape/apes@latest` to update.
```

Cached for 24h at `~/.config/apes/.version-check.json` so it's a one-time network hit per day. The fetch is bounded by a 2s `AbortSignal` so command startup never blocks for long even when offline. Suppress with `APES_NO_UPDATE_CHECK=1` (CI, scripts that pin a specific version).

Catches the foot-gun where you forgot `npm i -g` after a release and silently keep using behavior that's been fixed upstream.
