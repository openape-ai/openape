---
'@openape/apes': patch
---

docs(apes): document login-shell installation for interactive `ape-shell` + add non-regression integration tests

Expands `packages/apes/README.md` with the interactive REPL workflow, the login-shell install recipe (`/etc/shells` + `chsh`), and explicit documentation that the one-shot `ape-shell -c "<cmd>"` path continues to work unchanged under `SHELL=$(which ape-shell)`.

Adds `packages/apes/test/shell-login-integration.test.ts` — a spawned-subprocess test that builds the CLI, symlinks it as `ape-shell` in a tmp dir, and asserts:

1. `ape-shell -c "echo hello"` reaches the one-shot rewrite path and exits (no REPL loop, no hang)
2. `ape-shell --version` prints a versioned banner
3. `SHELL=<path-to-ape-shell> bash -c "…"` still works as a non-regression smoke check
