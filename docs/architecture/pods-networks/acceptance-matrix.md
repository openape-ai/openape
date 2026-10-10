# Pods networks — M13 synthetic acceptance matrix

Source: canonical main after the M12 merge (`a5a1c702e17552d69af3aa889b9dc4a5a295bd7b`, main run 5372 green; the same unit suite passes on the M13 branch, 149 files / 1258 cases, single worker). Each row names the retained automated cases that produce the required observable result on that source, or states honestly that the row is only partly covered or not covered and therefore belongs to the native checks on the installed candidate. "Synthetic" means a mocked script process with a real store, dispatcher and engine; no real mail, LLM or Telegram provider is contacted. Paths are relative to `apps/openape-pods/test/`.

| Scenario | Required observable result | Retained case(s) | Coverage |
| --- | --- | --- | --- |
| Standalone deterministic/Jev/LLM Pod | Existing operation and rights preserved; validated results only enter declared channels | `scheduling/scheduler.test.ts` "retains every distinct input, acknowledges duplicates and commits completion once", "defaults schedules off, preserves accepted input across restart and rejects queue overflow"; `scheduling/graphs.test.ts` "rejects a script that emits outside its contract" | partial: deterministic Pod and channel contract only; Jev/LLM Pods are native checks |
| Finite workflow with parallel branches | One start, required joins, preserved outputs, one terminal result | `scheduling/workflows.test.ts` "holds descendants after failure while independent branches complete, then retries only failed work"; `scheduling/item-flow.test.ts` "joins only one explicit case revision, lets complete invoices pass and retains timeout review for late inputs"; `scheduling/workflow-calls.test.ts` "resolves a missing output only with explicit owner evidence while retaining completed effects" | synthetic |
| Persistent source timers differ | Each source fires independently; consumers run on their own ready work | `scheduling/item-flow.test.ts` "settles persistent consumer A while B is held, deduplicates source versions and preserves paused work" (one manual source, independent consumers); `scheduling/graphs.test.ts` "pins schemas, definitions, source bindings and independent source schedules" (definition only) | partial: no retained case runs two sources on different timers; native check |
| Slow/failing branch and held gate | Other branches complete; failures and waiting items inspectable | `scheduling/network-prototype.test.ts` "fences a stopped consumer without invalidating a healthy branch or allowing effect begin"; `scheduling/item-flow.test.ts` "holds items at a gate across runs and hands nothing on without a decision" | synthetic |
| Source cursor crash and duplicate input | No accepted item lost; same identity/version creates no second delivery | `scheduling/network-events.test.ts` "maps channels of one source version to the same case and advances only a new version"; `scheduling/network-prototype.test.ts` "does not advance the cursor on a conflicting source item", "refuses old source authority after restart"; `scheduling/scheduler.test.ts` duplicate acknowledgement | synthetic (crash modeled as conflict and restart, not a killed process) |
| Crash/late callback at each transaction boundary | One local settlement or preserved work; stale epoch cannot commit | `scheduling/network-events.test.ts` "fences boot, restore and epoch changes while allowing active work to settle during pause", "fences an expired source callback and refuses late successful settlement"; `scheduling/network-prototype.test.ts` "fences timer-source callbacks separately and retains source work after a timeout", "refuses membership and activation-epoch changes while leaving other members valid" | partial: boot/restore/epoch, expired source callback and timer timeout boundaries; other boundaries are native checks |
| External request outcome unknown | No automatic resend; case links to reconciliation and original receipt | `scheduling/network-events.test.ts` "blocks successful settlement with an unresolved effect and retains an unknown receipt"; `scheduling/network-prototype.test.ts` "keeps confirmed effect evidence across restart without issuing it twice", "refuses a reused completed effect key with changed input" | synthetic (no production network effect writer exists; the legacy effect ledger is the executed path) |
| Shared record revision conflict | No partial record/event commit; conflict identifies record and revision | `storage/network-data.test.ts` "rejects a stale writer and rolls back all records of the transaction"; `scheduling/network-prototype.test.ts` "deduplicates derived emits and rolls back conflicting derived content" | synthetic |
| Two companies use one definition | Distinct identities/home/state; denied cross-company data and artifacts | `storage/network-data.test.ts` "refuses cross-company collections" and the artifact scope refusals in the same file | partial: cross-company data/artifact refusal; two instances of one definition in two companies with separate homes is a native check |
| Definition update with held work | Old work stays pinned or explicitly blocks; no hidden permission expansion | `scheduling/network-gates.test.ts` "retains completed approval evidence without offering historical decisions after composition replacement", "invalidates the frozen approval after the consumer permissions change" | synthetic |
| Owner grant changed/expired/consumed | Correct refusal or uncertainty; no substituted authorization | `scheduling/gates.test.ts` "moves nothing when the identity provider reports the grant as expired", "moves nothing when the consumed grant is no longer valid at the moment of the move", "never consumes the grant of a batch from which the owner excluded an item" | synthetic |
| Network calls workflow and caller pauses | One correlated execution/result; no held lease; result retained | `scheduling/workflow-calls.test.ts` "accepts repeated invoice requests once, releases the caller lease and retains a paused network result", "recovers retained result delivery with explicit owner evidence after permission drift" | synthetic |
| Join missing input or late arrival | Visible deadline outcome; no unrelated case mix or silent reopening | `scheduling/item-flow.test.ts` "joins only one explicit case revision, lets complete invoices pass and retains timeout review for late inputs" | synthetic |
| Feedback reaches bound | Review outcome and complete causation trace; no runaway loop | `scheduling/feedback.test.ts` both cases; `scheduling/workflow-calls.test.ts` "delivers workflow results with the feedback hop their case has reached"; `scheduling/graphs.test.ts` "rejects undeclared feedback and accepts one declared bounded transition" | synthetic |
| Storage quota and retention | Visible intake backpressure; pending evidence and deduplication survive | `scheduling/network-recovery.test.ts` "pauses quota-saturated intake without committing staged progress and resumes only after explicit capacity review" | synthetic |
| Offline browser/runtime and old client | Clear availability/version message; no fabricated successful action | `scheduling/graph-ui.test.ts` "keeps explicit Pod pause review separate from selection and retains an action refusal across polling" (refusal retained, no fabricated success) | not covered: no retained offline or old-client version case; native check in the browser and the installed app |
| Migration/export/import | Reviewed baseline, preserved owner state, paused imports, no copied credentials/grants | `scheduling/item-flow.test.ts` "requires baseline review before activation or manual processing of a restored network"; `workspace/sharing-import.test.ts`, `workspace/sharing-ui.test.ts`; `scheduling/portable-composition.test.ts` | synthetic |

Native checks on the installed candidate that no retained case covers: a real `.openape` package exported and imported through the installed app, Jev/LLM Pods under the network model, two independent source timers, two companies sharing one definition, offline browser and old-client messages, mail finalization of an imported policy, called channel graphs and runtime calls of imported compositions, feedback through a workflow call end to end, and the relay-first rollout with owner-state fingerprints.

### Delta Mind correction: additional retained cases

- `network-runtime-ports.test.ts`: assigned CLI dispatch without a network read
  budget, foreign assignment refusal, unavailable ports, Jev
  failure/cancellation/revocation, paused processing and empty-input behavior.
- `network-member-capabilities.test.ts`: a source → program-reading consumer →
  HTTP-posting consumer chain with its secret processes one item end to end;
  missing IdP grants refuse program and HTTP calls without sending anything;
  programs, destinations and secrets of another member stay unreachable.
- `network-routing.test.ts`: owner choice identity, duplicate decision, original
  case and independent delivery preservation, unresolved retirement guards,
  restart/restore fencing and incompatible gate schema rejection.
- `network-gates.test.ts`: original frozen grant channel versus approved consumer
  channel, explicit exclusion output without duplicate delivery.
- `network-migration.test.ts`: inspected interrupted run with cancelled parent
  converts without rewriting the run or recovery record; pending legacy choices
  prevent conversion while their original UI remains available.
- `network-mail-intake.test.ts`: real-shaped provider IDs/versions, explicit
  bounded baseline without emissions, unchanged version suppression and refusal
  of absent provider versions or standalone baseline replacement.

These are synthetic behavioral checks. They do not establish installed Pod
credentials, native CLI execution, live Jev behavior, production conversion,
release acceptance or browser/desktop presentation. Those require separate
recorded real acceptance before claiming completion.

## Bounded local MCP correction

- `codex/control.test.ts`: the owner session administers network members like other Pods; the shared engine still refuses their direct runs, Pod schedules and workflow membership.
- `codex/networks.test.ts`: owner-scoped bounded reads, explicit paused selection, stable preview/process receipts, owner/argument mismatch and failed-operation refusal; creation, activation and a member script change of a joined network with a daily source, a choose decision, and no MCP command that approves or denies a pending IdP batch.
- `main/codex-routing.test.ts`: network reads and mutations are routed and validated before the worker; `main/codex-server.test.ts` refuses every route without the owner session; `main/worker-lifecycle.test.ts` sends desktop commands and `gateOpen` to the desktop producers.
- `main/worker-lifecycle.test.ts` and `main/worker-entry.test.ts`: trusted owner-operation propagation, actual closed-gate start dispatch, duplicate run identity, suspended denial and no unrelated scheduler tick.
- Manual `e2e/codex-acceptance.test.ts`: packaged Codex app-server and MCP socket manage an unrelated Pod beside a real synthetic network, then admit one native network invocation while preserving pause and replaying the same receipts. `e2e/codex-mcp.test.ts` verifies packaged tool discovery.

These checks use synthetic providers. Installed-owner MCP readback and actual
provider acceptance are recorded separately in issue1417 and the approved plan.
