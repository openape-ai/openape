---
"@openape/apes": minor
---

git-style dispatch for unknown subcommands: `apes <sub>` now runs `apes-<sub>`
from PATH when `<sub>` is not a builtin. Installing a subcommand is
`npm i -g @openape/apes-<sub>`, removing it is `npm rm -g`. The child inherits
nothing but a freshly refreshed `~/.config/apes/auth.json`, which it reads
through `@openape/cli-auth` like every other OpenApe CLI.
