# Fix: Grant-Secured Shell Findings — 2026-04-13

**Status:** Draft, ready for execution in a fresh session
**Repos touched:** `openape-monorepo` (primary), `openclaw` (secondary, possibly)
**Created by:** Debugging session 2026-04-13 afternoon — after the PR #84 (notifications) merge plus the M1-M7 interactive shell weekend
**Expected duration:** One or two focused sessions, depending on how many findings turn out to be investigation rather than direct fix

---

## How to use this file

You are a fresh Claude session. You have not seen the debugging conversation that produced this document. Everything you need is below. Read the whole document first before touching any code.

**Ground rules:**

1. **Do not write a blog post, LinkedIn post, or any social content.** That is out of scope. Content is being handled in a separate workstream. Your job is code.
2. **Do not invent narrative details.** If you don't know something, say so or investigate.
3. **Do not break existing tests.** Both repos have full suites. Run them before every commit.
4. **Do not touch files protected by `CODEOWNERS`** unless an owner explicitly asked for it in this document (none here).
5. **Do not rename `apes` to `escapes` or touch anything related to that migration.** That rename is explicitly off.
6. **Follow both repos' CLAUDE.md / AGENTS.md strictly.** `openclaw/CLAUDE.md` has important rules about prompt cache stability, extension boundaries, and multi-agent safety. `openape-monorepo` has its own. Read them.
7. **Prompt cache stability is correctness-critical in openclaw.** Do not casually reorder collections, rewrite transcript bytes, or restructure system prompts without thinking about how the prefix stays stable.
8. **Ask for approval before any push to `main`, before any `npm publish`, before any version bump, and before any changeset merge.** The user is Patrick Hofmann, he is explicit about release safety.
9. **Where a finding needs design input, do not guess.** Stop, summarize the options, wait for direction.

---

## Context — the setup being debugged

Patrick Hofmann has been building `ape-shell` (inside `openape-monorepo/packages/apes`) as a grant-secured shell wrapper. Last weekend (2026-04-11 / 2026-04-12) it went from an argv-rewriting one-shot wrapper to a full interactive REPL via M1-M7 milestones plus a pending-grant notification feature (PR #84, merged 2026-04-12).

On 2026-04-13 afternoon, Patrick ran the first real end-to-end debugging pass where he exercised the stack through `openclaw` (an AI agent gateway at `~/Companies/delta-mind/repos/openclaw`) via Telegram. openclaw spawns commands against a dedicated `openclaw` OS user whose login shell was set to `ape-shell`. The agent received messages from Telegram, issued `exec` tool calls, those calls were supposed to be routed through `ape-shell`, which would gate each command via OpenApe grants served from `https://id.openape.at`.

The reality was messier than the design. Seven distinct findings surfaced during roughly 90 minutes of live testing. This plan captures all of them with enough context that you can investigate and fix without needing to re-derive the knowledge. The original debugging conversation is archived in the social-media workstream but is NOT required reading for this work.

### Architecture quick reference

- **openclaw** exec tool entry: `openclaw/src/agents/bash-tools.exec.ts` (+ `bash-tools.exec-runtime.ts`, `bash-tools.process.ts`)
- openclaw yields to agent after `yieldMs` (default 10s, may be configurable per-agent) with text response `"Command still running (session X, pid Y). Use process (list/poll/log/write/kill/clear/remove) for follow-up."`
- openclaw has its **own** approval system at `openclaw/src/infra/exec-approvals.ts` with safe-bins allowlist. This is **separate** from OpenApe grants. Do not confuse the two.
- openclaw's `notifyOnExit` defaults to `true` (`bash-tools.exec.ts:1387`). When a backgrounded session exits, `maybeNotifyOnExit` calls `requestHeartbeatNow(..., { reason: "exec-event" })` via `openclaw/src/infra/heartbeat-wake.ts`.
- **ape-shell** entry: `openape-monorepo/packages/apes/src/shell/` (REPL dispatcher, pty-bridge, grant-dispatch)
- ape-shell's pending-grant notification (PR #84): `packages/apes/src/notifications.ts`, called from `packages/apes/src/shell/grant-dispatch.ts` and `packages/apes/src/commands/run.ts` before both wait loops
- ape-shell's interactive REPL was built across M1-M7 (PRs #63, #65, #68, #69, #70, #71, #72) with `PtyBridge` for persistent bash-child, marker-based prompt detection, grant flow integration, audit logging, login-shell install.
- OpenApe grants REST: `openape-monorepo/packages/grants/` and served via the free-IdP at `apps/openape-free-idp/` under `id.openape.at`.

### Relevant recent commits in `openape-monorepo` (since 2026-04-09)

You can pull exact diffs via `git log --oneline --since="2026-04-09"` in the repo. The content-relevant ones are:

- `feat(apes): M1-M7 interactive REPL` (#63 #65 #68 #69 #70 #71 #72)
- `feat(apes): transparent session auto-refresh — no hourly re-login` (#75) — may be relevant to Finding 6
- `feat(apes): configurable notification when grant approval is pending` (#84) — central to Finding 5
- `test(apes): E2E notification test using file-based pending_command` (#86)
- `fix(apes): use SIGKILL in pty-bridge tests for reliable CI termination` (#87)
- `feat(apes): literal positionals, drop deprecated @openape/shapes` (#80) — may interact with Finding 4
- `fix(apes): ship scripts/ dir so global install works` (#78)
- `fix(apes): suppress pty input echo in interactive shell` (#76)
- `fix(apes): resolve symlink chain in ape-shell-wrapper.sh` (#74)
- `fix(apes): login-shell wrapper for environments without node on PATH` (#73)
- `feat(grants): proactive widening suggestions on grant approval` (#48)
- `fix(apes): adapter lookup normalizes paths and matches on executable` (#57) — may interact with Finding 4

---

## The seven findings

Each finding has the same structure: **symptom** (what Patrick observed), **suspected location** (where to look), **hypothesis** (what's probably wrong), **severity**, **is it a bug or design**, and **scope** (fixable in one pass, needs investigation, needs design discussion).

### Finding 1 — openclaw agent bypasses ape-shell for simple file operations

**Symptom:** When Patrick asked the openclaw agent via Telegram to "create a file `test.file.txt`", the agent executed a grant-requiring operation ONCE at the start, but subsequent file-ops like `date +%s >> ~/test-grant.txt` and `openssl rand -hex 4 >> ~/test-grant-rand.txt` went through without any grant request or visible wait. Patrick's belief: the agent is using openclaw's built-in `Write` / `Edit` / file-touch tools for simple file operations, not routing them through the `exec` tool, and therefore not through `ape-shell` at all.

**Suspected location:** `openclaw/src/agents/**` — specifically any built-in file manipulation tools (not `exec`). Look for tools registered that can create/modify files without going through `exec`. Also look at `src/agents/pi-tools.ts` and `src/agents/bash-tools.*` for the full tool surface.

**Hypothesis:** openclaw's agent toolset includes built-in file tools that completely bypass the shell layer. These are by-design for performance and reliability of simple ops, but they architecturally short-circuit any grant-gating layer that Patrick installed at the shell level. This is **not a bug** — it's a security model surprise.

**Severity:** Medium. It does not break anything, but it means `ape-shell`'s security value is smaller than the user expects: grants only gate commands that the agent actually routes through `exec`, and the agent routes less through `exec` than Patrick realized.

**Scope:** This is a **design discussion**, not a fix. Do NOT remove built-in tools unilaterally. Do NOT route built-in tools through ape-shell without explicit approval from Patrick — that would be a cross-repo architectural change.

**What to do in this session:**
1. Enumerate openclaw's full tool surface. Produce a list of tools that touch files/commands, categorized by "goes through exec" vs "does not."
2. Write the list into this plan file under a new section named "Tool Surface Enumeration" with citations to the source files where each tool is registered.
3. Stop. Do not act on it. Patrick needs to decide the product direction.

**Acceptance criterion:** A bulleted list in this file showing which openclaw tools are in-scope for grant-gating and which are not, with file references.

#### Tool Surface Enumeration (2026-04-13, read-only scan of `~/Companies/delta-mind/repos/openclaw/src/agents/`)

Categorization: **exec-path** routes through `bash-tools.exec` and is therefore gated by `ape-shell` when the login shell is configured; **direct file op** bypasses the shell and hits the filesystem directly; **direct network / API** makes HTTP/SDK calls; **media generation** calls provider SDKs directly; **meta/control** manages the agent/session; **content manipulation** reads or writes structured content. Top ~30 user-visible tools.

| Tool | File:line | Category | Gated by ape-shell? |
|---|---|---|---|
| `exec` | `src/agents/bash-tools.exec.ts:1387` | exec-path | **yes** |
| `process` | `src/agents/bash-tools.process.ts` | exec-path | **yes** (same pty session) |
| `read` | `src/agents/pi-tools.ts:410` | direct file op | no |
| `write` | `src/agents/pi-tools.ts:420` | direct file op | no |
| `edit` | `src/agents/pi-tools.ts:427` | direct file op | no |
| `apply_patch` | `src/agents/apply-patch.ts` | direct file op | no |
| `web_search` | `src/agents/tools/web-search.ts:38` | direct network/API | no |
| `web_fetch` | `src/agents/tools/web-tools.ts` | direct network/API | no |
| `image_generate` | `src/agents/tools/image-generate-tool.ts` | media generation | no |
| `image` | `src/agents/tools/image-tool.ts` | media generation | no |
| `video_generate` | `src/agents/tools/video-generate-tool.ts` | media generation | no |
| `music_generate` | `src/agents/tools/music-generate-tool.ts` | media generation | no |
| `tts` | `src/agents/tools/tts-tool.ts` | media generation | no |
| `pdf` | `src/agents/tools/pdf-tool.ts` | media generation | no |
| `message` | `src/agents/tools/message-tool.ts` | meta/control | no |
| `gateway` | `src/agents/tools/gateway-tool.ts` | meta/control | no |
| `agents_list` | `src/agents/tools/agents-list-tool.ts` | meta/control | no |
| `subagents` | `src/agents/tools/subagents-tool.ts` | meta/control | no |
| `sessions_list` | `src/agents/tools/sessions-list-tool.ts` | meta/control | no |
| `sessions_history` | `src/agents/tools/sessions-history-tool.ts` | meta/control | no |
| `sessions_send` | `src/agents/tools/sessions-send-tool.ts` | meta/control | no |
| `sessions_spawn` | `src/agents/tools/sessions-spawn-tool.ts` | meta/control | no |
| `sessions_yield` | `src/agents/tools/sessions-yield-tool.ts` | meta/control | no |
| `session_status` | `src/agents/tools/session-status-tool.ts` | meta/control | no |
| `cron` | `src/agents/tools/cron-tool.ts` | meta/control | no |
| `canvas` | `src/agents/tools/canvas-tool.ts` | content manipulation | no |
| `nodes` | `src/agents/tools/nodes-tool.ts` | content manipulation | no |
| `update_plan` | `src/agents/tools/update-plan-tool.ts` | content manipulation | no |
| plugin tools (dynamic) | `src/agents/openclaw-plugin-tools.ts` | varies | depends on plugin impl |

**Security-model takeaway:** only `exec` and `process` flow through `ape-shell`. The four direct file ops (`read`, `write`, `edit`, `apply_patch`) are the primary "silent bypass" surface — they explain why, during the 2026-04-13 live test, file writes proceeded without grant prompts after the first gated command. That behavior is by-design in openclaw for performance and reliability of simple reads/writes; it is not a bug in ape-shell. The meta/control tools (session/agent management), direct network/API (`web_search`, `web_fetch`), and media generation tools are all similarly outside the shell boundary.

**What this means for Patrick:** if you want `ape-shell` to gate EVERY filesystem touch, you would need an upstream change in openclaw — either (a) routing its built-in file tools through a sandbox/hook interface that ape-shell can intercept, or (b) a plugin/configuration that disables those built-ins when a grant-secured shell is in use. Both are cross-repo decisions and not actionable from openape-monorepo alone. Until then, the security value of `ape-shell` is limited to commands the agent routes through `exec`, which may be fewer than you expect.

No action in this finding beyond the enumeration above. Decision on whether to pursue an upstream openclaw change is deferred.

---

### Finding 2 — Cache hits on approved grants are silently reused, no indicator

**Symptom:** In the interactive ape-shell REPL, after approving a grant once (e.g., for `date`), subsequent invocations of the same semantic shape (e.g., `date +%s >> ~/test-grant2.txt`) run immediately with no output line indicating "reusing grant X." The user cannot tell from the shell output whether a command ran freshly, rode on a session grant, rode on a timed grant, or rode on an always-grant.

**Suspected location:** `openape-monorepo/packages/apes/src/shell/grant-dispatch.ts` and the grant lookup / cache layer. Also possibly `packages/apes/src/commands/run.ts` for the one-shot path.

**Hypothesis:** The grant dispatch logic correctly reuses cached grants (this is the zero-latency re-execution feature from the Post #2 BiP story) but the dispatch path does not emit any user-facing line when a cache hit occurs. It only emits the "Requesting grant for: ..." line when a grant is being requested fresh. When the lookup finds a match, it silently proceeds to execute.

**Severity:** Medium — UX issue, not a correctness issue. But it has security implications: the user cannot see what rights the agent is currently using.

**Scope:** Fixable in one session.

**What to do:**
1. Read `grant-dispatch.ts` (REPL path) and the corresponding code in `commands/run.ts` (one-shot path).
2. Find where grant lookup returns a cached match.
3. Add a single dim/muted line like `→ reusing grant <short-id> (approved HH:MM, expires HH:MM)` immediately before the command is passed to the pty. Use `consola.info` or the existing info helper used for "Requesting grant for" to stay consistent.
4. The line must be suppressible via an env var `APES_QUIET_GRANT_REUSE=1` or similar, because power-users may want a clean stream. Default: show.
5. Add one unit test that verifies the line is emitted on cache hit and not emitted on fresh grant.
6. Update `packages/apes/test/shell-grant-dispatch.test.ts` if that is the right test file.
7. Add a changeset describing the UX change.

**Acceptance criterion:** In an interactive ape-shell REPL, run a command, approve it, run the same command again. The second run must show a one-line acknowledgment of the cache hit including grant id and approval time. Tests must pass.

---

### Finding 3 — No visible acknowledgment line when a pending grant is approved

**Symptom:** In the interactive REPL:

```
apes$ date
ℹ Requesting grant for: Show current date and time                    2:19:45 PM
ℹ Approve at: https://id.openape.at/grant-approval?grant_id=d524...   2:19:46 PM
Mon Apr 13 14:19:55 CEST 2026
apes$
```

Between the approve-URL line at `2:19:46 PM` and the command output at `14:19:55`, the grant was approved externally (via browser) and the command proceeded. But there is NO output line saying `✓ grant approved at 2:19:54 PM — continuing`. The user cannot tell whether the command waited (blocked on grant) or ran through a cache hit.

**Suspected location:** `packages/apes/src/shell/grant-dispatch.ts` — the wait loop that polls for grant approval. After the poll resolves with "approved", emit an acknowledgment line before handing off to execution.

**Hypothesis:** The wait loop resolves silently when the grant flips from pending to approved, and only the downstream command's own stdout is visible.

**Severity:** Medium — UX, same concern as Finding 2: observability of the security state.

**Scope:** Fixable in one session, likely in the same PR as Finding 2.

**What to do:**
1. Find the grant wait loop in `packages/apes/src/shell/grant-dispatch.ts` (or `commands/run.ts` for one-shot).
2. After the wait resolves with an "approved" outcome, emit `✓ Grant approved — continuing` (or similar) before executing.
3. Also emit a counterpart if the wait exits due to denial, timeout, or cancellation — those should be loud.
4. Add a test that verifies the approved-acknowledgment is printed.
5. Update changeset.

**Acceptance criterion:** In a fresh interactive REPL session, run a command that needs a grant, approve via URL, observe a `✓ Grant approved` line before the command output.

---

### Finding 4 — `apes <subcommand>` inside the interactive REPL breaks

**Symptom:**

```
apes$ apes grants list
ape-shell: unsupported invocation. Try `ape-shell --help`.
apes$
```

When Patrick ran `apes grants list` from inside the ape-shell REPL (which is the natural thing to do when debugging grants), the shell rejected the invocation. The error message came from `ape-shell` itself, not from bash — which means ape-shell is intercepting the `apes` binary name and routing it to its own subcommand handler, which then fails to recognize the subcommand argument shape.

**Suspected location:** The REPL's command dispatch path. Look at `packages/apes/src/shell/` for argv rewriting or command interception logic. Also `packages/apes/src/cli/` for the main CLI entry. The issue is likely in how the REPL decides what is "shell passthrough" vs "ape-shell meta command."

**Hypothesis:** The REPL sees `apes` as the first token and routes it to an internal dispatcher (probably the same dispatcher that handles `exit`, `help`, etc.) instead of passing it through to the actual `apes` binary on PATH. The internal dispatcher doesn't know `grants list` as a valid local subcommand and errors. Alternatively, this could be a `$0`/basename resolution bug where ape-shell thinks it IS the binary being invoked.

**Severity:** High for user experience. It breaks self-inspection entirely: the user cannot check grants, whoami, session status, or anything else from within the shell that represents that session. And without self-inspection, the observability of the security state collapses (compounds Findings 2, 3, and 7).

**Scope:** Fixable in one session, but needs careful testing to avoid breaking the intentional shell behavior (e.g., `cd`, `export`, aliases, etc. must still work).

**What to do:**
1. Reproduce from a fresh REPL: start `ape-shell -i` (or whatever the interactive invocation is), then type `apes whoami`, `apes grants list`, `apes --version`. Capture exact error output for each.
2. Locate the dispatch logic in `packages/apes/src/shell/**`. Search for where argv is parsed and where the decision is made whether to handle a command internally or pass through.
3. Fix: when the first token is `apes`, **always** route to the external `apes` binary (not to internal ape-shell dispatch). The external `apes` binary is the user-facing CLI and should be reachable from inside the grant-gated shell — gated by a grant if necessary, but reachable.
4. Make sure this does not break the ape-shell's OWN self-invocation path (ape-shell calling itself as an argv rewriter).
5. Tests: add cases for `apes whoami`, `apes grants list`, `apes --help` all being routable from inside the REPL.
6. Also fix this for `ape-shell` itself (the binary name) — if the user runs `ape-shell --version` from inside ape-shell, what should happen? Document the decision in a comment.
7. Changeset.

**Acceptance criterion:** From inside an interactive `ape-shell` REPL, `apes whoami` and `apes grants list` must work. Output must match what they would output when called from a plain bash.

---

### Finding 5 — The Silent-Agent-Block (original symptom, not yet reproduced in a controlled test)

**Symptom (Patrick's own description):** When the openclaw agent runs a grant-gated command through ape-shell via Telegram, the flow is:
1. Agent issues `exec` with some ape-shell command
2. After ~30 seconds, Telegram says "bitte approve den Grant at [URL]"
3. Patrick approves via the URL
4. **NOTHING HAPPENS AUTOMATICALLY in the Telegram chat**
5. Patrick has to type "bestätigt" or "I approved" or similar in Telegram
6. Only then does the agent say "done" and continue

**Suspected location:** This one is ambiguous between two codebases. Could be in openclaw (`src/agents/bash-tools.exec-runtime.ts`, `src/agents/bash-tools.exec.ts`, `src/infra/heartbeat-wake.ts`), could be in ape-shell (`packages/apes/src/shell/grant-dispatch.ts`, `packages/apes/src/notifications.ts`), could be in the boundary.

**Hypotheses (in priority order for investigation):**

- **H1 — Agent prompt behavior:** openclaw's exec correctly yields after `yieldMs` with "Command still running, session X, use process tool for follow-up." The agent's LLM reads this, surfaces "please approve" to Telegram, but does NOT schedule a `process(action=poll, sessionId=X, timeout=300000)` call. It just ends its turn. When the backgrounded session eventually exits, `requestHeartbeatNow("exec-event")` fires — but the heartbeat either does not wake the Telegram-bound agent, or wakes it and finds nothing in the user message queue and goes back to sleep. Patrick's manual "bestätigt" message is what actually gives the LLM a reason to continue, at which point it re-polls the session and finds the output.

- **H2 — Session-key mismatch in wake:** the heartbeat wake via `scopedHeartbeatWakeOptions(sessionKey, { reason: "exec-event" })` uses a session-key that does not match the Telegram agent's session-key, so the wake is a no-op for Telegram-bound agents.

- **H3 — ape-shell does not cleanly exit after approve:** the grant approval is detected by ape-shell, but the shell lifecycle does not terminate the subprocess cleanly — it stays in the REPL or in a wait state that openclaw cannot observe as "exited." `notifyOnExit` never fires because the process never exits.

**What Patrick already knows (partial signals from the debugging session):** Finding 1 (agent uses built-ins for simple ops) means that many of the file-op tests done today did NOT actually route through ape-shell. So any observation of "no wait, command runs immediately" might be because built-ins were used, not because ape-shell failed. The Silent-Agent-Block was originally observed in a session where a real ape-shell grant was needed, but it has NOT been reproduced in a clean, controlled test after today's discoveries. Reproduction is the first task.

**Severity:** High if real and user-facing. The whole point of grants-backed agents is that they can run semi-autonomously once the human approves. If the human has to babysit the Telegram chat after every approve, the loop is broken.

**Scope:** Investigation required BEFORE any fix. Do not guess. Do not write a speculative fix.

**What to do:**

**Step 1: Set up a clean reproduction environment.**

- Ensure `openclaw` OS user has `$SHELL` set to the real path of `ape-shell` (current state: chsh was reverted to /bin/bash during debugging). Use `sudo chsh -s $(which ape-shell) openclaw`.
- Verify: `sudo -u openclaw bash -c 'echo $SHELL'` should show ape-shell.
- Restart the openclaw gateway via the macOS menubar app (NOT via SSH/tmux per openclaw CLAUDE.md: "When debugging on macOS, start/stop the gateway via the app, not ad-hoc tmux sessions").
- Check `./scripts/clawlog.sh` usage in openclaw repo — it tails unified logs for the OpenClaw subsystem with follow/tail/category filters.

**Step 2: Pick a test command that will DEFINITELY route through `exec` and NOT be short-circuited by openclaw built-ins. Good candidates:**
- `curl -s -o /tmp/grant-probe-$(date +%s).json https://httpbin.org/uuid && echo probe-done`
- `shasum ~/.zshrc >> /tmp/grant-probe-hash.txt && echo probe-done`
- A user-written shell script at `~/bin/grant-probe.sh` that the agent is asked to execute via path: `führe aus: ~/bin/grant-probe.sh`

Avoid: `touch`, `mkdir`, `echo >`, `date`, `ls`, anything that looks like a trivial file op. Those are the ones most likely bypassed per Finding 1.

**Step 3: Before each test, ensure a clean grant state.**

From a **plain bash window** (not inside the ape-shell REPL — see Finding 4 until it is fixed):
```bash
apes grants list
# revoke every grant that might match the test command
apes grants revoke <id>
# confirm empty
apes grants list
```

**Step 4: Run the test and observe multiple layers simultaneously.**

- Telegram chat visible
- `./scripts/clawlog.sh -f | grep -E 'exec|grant|heartbeat|session'` in one terminal
- `ps auxf | grep -E 'ape-shell|apes'` in another terminal, refreshed manually
- The grant approval browser tab ready

Agent prompt from Telegram:
```
führe aus: curl -s -o /tmp/grant-probe-$(date +%s).json https://httpbin.org/uuid && echo probe-done
```

Expected timeline:
- T+0: Agent issues exec
- T+30s: openclaw yields, agent tells Telegram "please approve"
- T+35s: Patrick approves via URL
- T+36s: **OBSERVATION POINT 1** — does Telegram receive any automatic message? Does the log show a `heartbeat-wake` event? Does `ps` still show the ape-shell child?
- T+40s: **OBSERVATION POINT 2** — same questions, 5 seconds later
- T+60s: Patrick writes "poll the session" in Telegram
- T+61s: **OBSERVATION POINT 3** — what does the agent do now?

**Step 5: Match observations to hypotheses.**

| Observation | Diagnosis |
|---|---|
| Log shows `heartbeat-wake reason=exec-event` after approve, agent does nothing | H1 or H2 — the wake fires but the agent does not resume. Differentiate by checking if the session-key matches the agent's. |
| Log shows NO `heartbeat-wake` event after approve | H3 or H2 — either the session never exited (inspect `ps` for still-running ape-shell child) or the wake never fired for this session-key. |
| `ps` shows ape-shell child still alive after approve | H3 — ape-shell is not terminating cleanly. Investigate `packages/apes/src/shell/grant-dispatch.ts` wait loop exit semantics. |
| Agent responds automatically a few seconds after "poll the session" | H1 confirmed — the LLM just needed a nudge because it never scheduled a poll. Fix is a stronger yield hint from openclaw exec tool. |

**Step 6: Based on the diagnosis, open exactly ONE of these issues:**

- **If H1:** `openclaw` issue titled `exec: after yieldMs, agent does not auto-resume on backgrounded exit for Telegram sessions`. Body: the exec yield result should include a structured hint to the LLM that it must schedule a `process(action=poll, ...)` call before ending its turn. Consider also an openclaw-side mechanism to force the next turn when a backgrounded session exits, independent of LLM choice.

- **If H2:** `openclaw` issue titled `exec: notifyOnExit heartbeat wake does not reach Telegram-bound agent sessions`. Body: log evidence, session-key comparison, proposed fix.

- **If H3:** `openape-monorepo` issue titled `ape-shell: grant-wait loop does not cleanly exit the child process after approval`. Body: evidence, ps output, proposed fix.

- **If none of the three clearly applies:** open an openclaw meta-issue `Silent-agent-block: long-running grant-gated commands — end-to-end wait protocol` with all findings as sub-tasks. Do not invent a fix. Wait for Patrick's direction.

**Acceptance criterion:** Either (a) the Silent-Agent-Block is reproduced in a controlled test and one of the three issues above is opened with complete evidence, OR (b) the symptom cannot be reproduced and this finding is closed as "not reproducible after Finding 1 is understood — revisit when a concrete repro emerges."

**Do NOT write a fix for the Silent-Agent-Block in this session unless you have full reproduction and the diagnosis is unambiguous. Guessing at a fix is worse than shipping no fix.**

---

### Finding 6 — ape-shell REPL can enter an unrecoverable state even when the auth token is valid

**Symptom:** During debugging, ape-shell started rejecting subcommands with "unsupported invocation" (Finding 4). Patrick assumed the session was lost and switched the openclaw user's shell back to `/bin/bash` as an emergency recovery. After the switch, he ran `apes whoami` from a clean bash session and found:

```
Email: agent+patrick+hofmann_eco@id.openape.at
Type:  agent
IdP:   https://id.openape.at
Token: valid (until 2026-04-13T14:25:31.000Z)
```

The token was shown in UTC and was still valid for ~1 hour at the time of the check (shell prompt showed 15:25 CEST = 13:25 UTC). **So the auth was fine.** The REPL got into a broken state for some reason unrelated to auth, and neither the REPL nor the user had any way to recover from within.

This is related to but distinct from Finding 4. Finding 4 is a specific bug in subcommand dispatch. Finding 6 is about the absence of a recovery path when the REPL reaches ANY unexpected state.

**Suspected location:** `packages/apes/src/shell/` — the REPL's top-level error handling, the interactive lifecycle loop, and whatever state the PtyBridge or grant-dispatch accumulates over the life of a session.

**Hypothesis:** The REPL accumulates state across commands (pending grant caches, pty-child state, session info, audit log buffers). If any subsystem gets into an unexpected state, the top-level REPL does not have a `reset` or `reload` mechanism. The user is stuck: they can't fix the state from inside because the tools for inspecting it (`apes grants list`, `apes whoami`) might also be broken (Finding 4), and they can't fix it from outside without killing the shell entirely.

**Severity:** Medium. Workaround exists (exit shell, reopen). But it undermines confidence that ape-shell is production-ready as a login shell.

**Scope:** Fixable in one session for a minimal version. A proper "self-healing" mechanism is a larger design.

**What to do:**
1. Add a REPL command `:reset` or `:reload` (or `\reset`, or whatever the REPL meta-command syntax is) that:
   - Flushes pending grant cache
   - Kills and respawns the pty child
   - Resets the audit logger
   - Re-validates the auth token
   - Prints a status line about what was reset
2. Add a top-level error handler in the REPL dispatch that catches unexpected exceptions, prints the error with a hint to run `:reset`, and keeps the REPL alive instead of crashing.
3. Add a `:status` command that prints the full state: current grant cache size, pty child pid, last auth refresh time, audit buffer size. This is the self-inspection tool that Findings 4 and 7 need.
4. Tests for each of `:reset`, `:status`, and the error-handler path.
5. Changeset.

**Acceptance criterion:** From inside an interactive REPL, `:status` prints state, `:reset` recovers from a deliberately injected error, and uncaught exceptions do not kill the REPL.

**Coordination with Finding 4:** These two should be fixed in the same PR if possible. They share the dispatch surface.

---

### Finding 7 — Diagnosis paradox: diagnosis tools live inside the broken shell

**Symptom:** When the REPL broke, Patrick could not use it to diagnose itself. All the tools for checking auth, grants, session status were either (a) subcommands of `apes` which were blocked by Finding 4, (b) output-only messages from within the REPL which were hidden by Finding 2, or (c) documentation which required him to step outside and use a different shell to read.

**Suspected location:** Cross-cutting. Not a single file. It's an absence, not a presence: there is no externally-observable health endpoint or probe that works regardless of the REPL's state.

**Hypothesis:** ape-shell was built as a self-contained grant-secured shell. It was not built with an external observer interface. When the self-contained part breaks, the user has no external lever.

**Severity:** Medium — compounds with Findings 4 and 6. Fixing either of those weakens this one, but a proper fix is still valuable.

**Scope:** Small fix, needs one new command.

**What to do:**
1. Add a new CLI subcommand: `apes health` (or `apes probe`). It runs as a standalone process, does NOT enter the REPL, does NOT talk to the pty child, does NOT read the grant cache from an in-memory store. It opens the persisted state files / config / auth files directly and reports:
   - Config location and whether readable
   - Auth token location, whether present, expiry time (both UTC and local)
   - Grant storage location and grant count
   - Audit log location and last line timestamp
   - Whether the IdP at the configured URL is reachable (simple HEAD probe)
   - Version of `apes` and `ape-shell` binaries
2. This command must work from ANY bash/zsh session, including a broken one, and must not depend on any REPL state.
3. Tests: add a test that exercises `apes health` in isolation.
4. Documentation in `packages/apes/README.md` under "Troubleshooting."
5. Changeset.

**Acceptance criterion:** `apes health` runs in under 2 seconds from a plain bash, works even if no REPL is running, and prints enough state for Patrick to diagnose whether the shell is a victim (token expired, IdP unreachable) or a perpetrator (REPL state corruption, Finding 4 / 6).

---

## Work order and prioritization

You should tackle findings in this order:

**Tier 1 — enables further work, highest leverage:**
1. **Finding 4** — `apes <subcommand>` from inside REPL. Without this, no self-inspection works, and Findings 2, 3, 6, 7 are harder to verify.
2. **Finding 7** — `apes health` external probe. Without this, you cannot verify your own fixes without trusting the broken tool.

**Tier 2 — direct UX improvements, independent of each other:**
3. **Finding 2** — silent cache hits. Add the reuse line.
4. **Finding 3** — missing approve acknowledgment. Add the approved line.
5. **Finding 6** — REPL recovery and status commands. Can be a separate PR from Findings 2/3/4.

**Tier 3 — requires investigation, may not end in a fix:**
6. **Finding 5** — Silent-Agent-Block. Investigation first, reproduction second, issue opening third. Fix only if H1/H2/H3 unambiguously resolves.

**Tier 4 — design discussion, do not attempt a fix:**
7. **Finding 1** — agent bypass via built-ins. Enumerate and document only.

**Suggested commit / PR structure:**

- **PR 1 (openape-monorepo):** Findings 2, 3, 4. All REPL UX / dispatch fixes together. One changeset.
- **PR 2 (openape-monorepo):** Finding 7 — `apes health` command. One changeset.
- **PR 3 (openape-monorepo):** Finding 6 — REPL `:status`, `:reset`, error handler. One changeset.
- **Investigation output (no PR yet):** Finding 5 — reproduction attempt + issue if reproduced.
- **Research output (no PR):** Finding 1 — tool surface enumeration appended to this plan file.

Each PR should be small, reviewable, and independently landable. Do not bundle Finding 5 or Finding 1 into a code PR — they do not belong in the same change as the UX fixes.

---

## Constraints and guardrails — read before editing anything

### From `openape-monorepo/CLAUDE.md` (go read it yourself, the below is excerpts)

- Use `scripts/committer "<msg>" <file...>` for commits, not manual `git add`/`git commit`.
- Conventional-commit style, max 80 chars for the first line.
- Never add Claude or any AI as co-author.
- `pnpm` is the package manager, Node 22+.
- Run `pnpm check`, `pnpm test`, `pnpm build` as appropriate before pushing.
- Tests go in `packages/apes/test/*.test.ts` — use vitest.
- Do not touch `.changeset/` files owned by other work unless you add your own.
- Do not touch `node_modules`.
- `pnpm patchedDependencies` requires exact versions, no carets/tildes.

### From `openclaw/CLAUDE.md` (you may need to read parts of openclaw for Finding 5)

- **Prompt cache stability is correctness-critical.** Do not casually reorder tool registrations, system-prompt sections, or anything that is part of the agent's LLM request prefix.
- Extension/plugin boundary must not be crossed from core. If you touch anything under `src/agents/**`, it is core.
- `openclaw` uses `pnpm check` for the default gate and `pnpm test` for landing.
- Restart openclaw gateway via the macOS menubar app during debugging, not via SSH/tmux.
- Use `./scripts/clawlog.sh` for log tailing.

### Multi-agent safety

- Do not create/apply/drop `git stash` entries.
- Do not switch branches without explicit instruction.
- Do not create/modify `git worktree` unless explicitly requested.
- Commit only your own changes. If you see unfamiliar files, investigate but do not delete.

### Release safety

- Do not bump versions.
- Do not run `npm publish`.
- Do not merge changesets.
- Do not push to `main` without explicit approval.

---

## Verification and exit criteria

You are done with this plan when:

1. **Finding 1:** Tool surface enumeration is written into this plan file under a new section. Not acted upon.
2. **Finding 2:** Cache-hit line is emitted, tests pass, changeset added.
3. **Finding 3:** Approved-acknowledgment line is emitted, tests pass, changeset added.
4. **Finding 4:** `apes whoami`, `apes grants list`, `apes --help` all work from inside the REPL, tests added, changeset added.
5. **Finding 5:** Reproduction attempted. Either (a) reproduced with diagnosis and one issue opened, or (b) documented as not-reproducible with explanation. No blind fix.
6. **Finding 6:** `:status`, `:reset`, error handler added, tests pass, changeset added.
7. **Finding 7:** `apes health` command works from plain bash, tests pass, changeset added.
8. **Overall:** PRs 1-3 are ready for review. You have NOT pushed to main. You have NOT published anything. You have NOT merged changesets.

Report back with:

- List of changed files per finding
- List of tests added per finding
- Changeset entries per PR
- Any findings that turned out to be different from the hypothesis above (with what you found instead)
- Any open questions for Patrick

---

## Out of scope for this plan — explicit

- Blog posts, LinkedIn content, social media. Patrick is handling these separately.
- The `apes`→`escapes` rename. Off the table.
- Domain migration openape.at → openape.ai. Separate plan at `~/.claude/plans/stateless-gliding-shore.md`.
- claude-grant-gate work at `~/.claude/plans/serialized-sprouting-starlight.md`. Separate.
- DOCPIT "Kein Kompromiss" content. Separate workstream.
- PR #84 rollback or redesign. The notification feature is fine as-is; Finding 5 is about whether openclaw consumes it correctly, not whether ape-shell emits it.

---

## What to do if something is unclear

Stop. Write your question into this plan file under a new section named "Open Questions for Patrick." Do not guess. Do not invent narrative or fabricate details. The debugging session that produced this plan did exactly that once and the user was correctly annoyed.

If you think a finding is wrong or the hypothesis is off, say so. Do not implement a fix for a hypothesis you do not believe.

If the fix for a finding turns out to be larger than expected (touching more files, requiring architectural changes), do not push through — stop, describe the scope, wait for direction.
