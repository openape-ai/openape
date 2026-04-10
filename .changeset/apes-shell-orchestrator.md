---
'@openape/apes': minor
---

feat(apes): wire interactive REPL to persistent bash child (M3 of ape-shell interactive mode)

Adds `runInteractiveShell` — the orchestrator that glues the M2 `ShellRepl` to the M1 `PtyBridge`. Each accepted line is now written to a real bash pty, output streams back live to the user's terminal, and the REPL waits for the prompt marker before accepting the next line. Raw-mode stdin forwarding makes interactive TUI apps (`vim`, `less`, `top`) work inside the session. SIGWINCH is forwarded to the pty so TUI apps re-render correctly on terminal resize.

State (cwd, environment variables, aliases, functions) persists across lines because a single bash process stays alive for the whole session. An integration test suite (`shell-orchestrator.test.ts`) exercises the full flow against a real bash child: simple commands, sequential state persistence, environment variable persistence, multi-line for-loops, and an assertion that the prompt marker never leaks into visible output.

No grant flow yet — every line executes unconditionally. That arrives in M4.
