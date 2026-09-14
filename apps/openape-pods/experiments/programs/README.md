# G0 program-session feasibility

These probes are **not application runtime code and are never packaged**. Run
from the monorepo root after activating the pinned Node toolchain:

```sh
pnpm --filter @openape/pods exec node experiments/programs/run.mjs
```

Requires macOS, Xcode command-line tools and the existing Firefox installation.
Uses fresh synthetic directories, no accounts, network requests, host profiles,
mail or scheduled pods. The Firefox probe directly executes the installed binary
with `-no-remote`, a fresh explicit profile and assigned read-only bundle files.
It never uses LaunchServices to delegate to an existing browser instance.

Exit 0 means the recorded boundaries pass, 1 is a harness failure, and 2 means a
concrete feasibility boundary remains open. The JSON receipt is written to
`.artifacts/program-feasibility.json`. This is a manual feasibility gate, not a
replacement for the application's existing automated acceptance suite.

## Findings on macOS 26.6.2 / arm64

- The current default-deny policy prevents the synthetic process from forking.
- Adding only `process-fork` permits `fork()` followed by `setsid()`. The child
  survives guardian completion even though the durable record says closed.
  The probe explicitly kills the known synthetic survivor; it also self-expires
  after 20 seconds. This is a **no-go for enabling general shell/child execution**
  with the current guardian. The production policy remains unchanged.
- A separate PTY prototype runs the sandboxed single-process fixture with a
  controlling terminal: all three stdio handles are TTYs. Unicode password input
  with echo disabled, resizing from 80×24 to 120×40 and Ctrl-C succeed. Measured
  startup was 27–28 ms in initial runs. This small fixture is not a measurement of
  Codex or arbitrary programs and does not prove production output backpressure.
- AppKit initialization and window API calls return in the synthetic fixture,
  with denied system-service diagnostics. That marker does not establish visible
  GUI behavior or isolation from global GUI services.
- Firefox with explicit bundle dependencies reaches its child-process startup,
  but GPU/socket bootstrap fails and the guardian timeout stops the process.
  It is unsupported by this tested policy; broader rights were not granted.

The current guardian deliberately owns a process group, not an inescapable
process container. Apple's XNU implementation of `setsid_internal` moves a child
into a new group/session. Polling PPIDs cannot reliably recover a child that forks
and reparents before the next poll. A wider process policy needs a separately
proven lifetime mechanism; simply polling faster is not an adequate fix.

Sources: [XNU process/session implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_prot.c),
[XNU coalition ownership](https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/kern/coalition.c).
Coalition management is privileged in the kernel source; this probe does not
claim an ordinary Electron app can create a pod-specific coalition.

## Next gate

Do not expose the proposed general shell or GUI launcher yet. Complete a revised
runtime approach first. A narrower alternative is a PTY attached directly to an
assigned foreground CLI, retaining fork denial; that supports single-process
CLIs but is **not** the full shell/GUI milestone approved in the plan. It needs an
explicit scope decision rather than being presented as equivalent completion.

Protected multi-file state, shell-to-broker streaming, pipeline backpressure,
host-instance reuse, GUI canaries and the setup-to-unattended handoff remain
unverified in this milestone. Existing regular-run boundary tests and the real
safeStorage credential test remain valid in their narrower scope.
