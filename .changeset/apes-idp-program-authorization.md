---
"@openape/apes": major
---

`apes run`, `ape-shell` and the MCP server authorize every program call at the
IdP instead of resolving it with local Shapes adapters (issue 1473, plan
revision 4, milestone M11). apes sends the program name (basename of the
executable found on `PATH`), the SHA-256 of that file and the exact arguments to
`POST {idp}/api/grants/authorize`. On `approved` it verifies the command token
(signature via the IdP's JWKS, issuer, audience `shapes`, own identity as
subject, target host, argv hash of exactly this command, hash of the file it is
about to run) and runs that file with these arguments; `pending` keeps the
existing behaviour (async info block and exit 75, or `--wait` / `APE_WAIT=1` for
up to 5 minutes, then authorize again; a wait that runs out never runs the
command); `denied` and `revoked` refuse. A single-use grant is consumed at
`POST /api/grants/{id}/consume` before the command runs (anything but `consumed`
refuses); identical calls reuse a reusable token until it expires. The
authorization endpoint comes from discovery
(`openape_program_authorization_endpoint`, default `/api/grants/authorize`). Nothing below
`~/.openape/shapes` is read while authorizing or running a command.

Major because local adapter execution is removed:

- `apes adapter install|update|verify|remove` are gone; `apes adapter
  list|info|search` show the adapters the IdP knows (`GET /api/shapes`).
  Installed files below `~/.openape/shapes` are no longer used by apes and can
  be deleted once the Pods desktop no longer reads them.
- `apes run --adapter <file>` and `apes explain --adapter` are refused.
  `apes explain` previews through the IdP's public `POST /api/shapes/resolve`.
- `--approval timed` is refused for program calls (use `once` or `always`); it
  stays available for `--as` and audience mode.
- `ape-shell`: a line that is exactly one program call (plain words, an
  executable file on `PATH`, no builtin) goes to the IdP; compound lines,
  expansions, redirections and builtins use the unchanged ape-shell session
  grant. An authorized program line is not handed to bash: the interactive
  shell starts the authorized file itself with exactly the authorized argv, in
  the working directory and exported environment bash recorded at its last
  prompt (so aliases, functions and traps of the session cannot replace it);
  relative program paths are refused there. Programs are located with symlinks
  resolved (the resolved file is hashed and run, the invoked path is argv[0]).
  Every path (`apes run`, `ape-shell -c`, REPL, MCP) re-hashes the file right
  before starting it and refuses a changed file or one that is not a regular
  file. The program name is a requester claim; the file
  that runs is bound by `program_sha256`. Gated agents must not have an
  agent-writable directory on their `PATH` or as a program location.
  Local segment-wise resolution of compound lines is removed. Audit
  entries record `grant_mode: "program"` instead of `"adapter"`.
- `apes grants run <id>` runs a program grant by locating and hashing the
  recorded program again (refused if the file changed) and authorizing at the
  IdP.
- The MCP server replaces its per-adapter `apes.run.<cli>.<operation>` tools
  with one `apes.run` tool (pending answers are returned; call again after
  approval).
- The `[generic]` config section (generic fallback switch and its audit log) is
  removed: the IdP approves programs without a registry shape as exact commands.
- Library exports `createShapesGrant`, `fetchGrantToken`, `findExistingGrant`,
  `verifyAndExecute` and `waitForGrantStatus` are removed. The Shapes re-exports
  and `@openape/apes/assigned` used by the Pods desktop are unchanged.

`apes run --as` (escapes), audience mode, ape-shell self-dispatch and the sudo
hint are unchanged. Requires an IdP that serves `POST /api/grants/authorize`
(M8); rollback is publishing the previous apes version.
