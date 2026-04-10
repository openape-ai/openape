---
'@openape/apes': patch
---

Ship `scripts/` directory in the published npm package so the `postinstall`
script `scripts/fix-node-pty-perms.mjs` actually exists after `npm install -g`.
Previously the `files` field only included `dist` and `README.md`, which made
global install fail with `Cannot find module fix-node-pty-perms.mjs`.
