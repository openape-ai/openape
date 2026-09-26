# Plan: Contact protection and Jev mail evaluation

## Purpose / Big Picture

Approved by Patrick on September 26, 2026: protect anyone he has contacted and explicit domains from archival; evaluate remaining mail through Jev; use the LLM only to summarize important messages. Existing concrete one-time archive grants remain necessary.

## Repository orientation

Canonical repository https://repos.openape.ai/patrick/monorepo; issue 1396. Checkout: openape-monorepo.worktrees/mail-briefing-grants; branch feature/issue-1396-mail-protection-jev; base 40113402. Existing examples/microsoft-mail.mjs, mail-triage.mjs and test/mail/{archive-provider,briefing}.test.ts under apps/openape-pods implement and verify the live assigned companion and recipe. Native archive execution verifies immutable assigned program hashes and exact approved command batches; the companion must additionally enforce current contact/domain protection before any provider POST.

## Milestones

1. Extend the Microsoft companion with a complete Sent Items recipient index (To/Cc/Bcc), durable per-mailbox union and validated Graph delta pagination. Persist in private assigned program state. Keep prior contacts after sent-message removal. Incomplete sync fails closed. Read an owner-maintained domain/address policy from a dedicated read-only path. Match exact domain boundaries including subdomains. Protect conversation participants and never treat the owner's mailbox itself as a protected external participant.
2. Route dispositions and priorities through bounded Jev questions; insufficient confidence retains mail. Hard-protected mail cannot be proposed for archive but can still need action. Only important selected messages use free-form LLM summaries with received-date anchoring. No LLM fallback for Jev errors. Retain explicit coverage gaps.
3. Extend existing behavioral tests for Sent pagination, To/Cc/Bcc, durable recipients, exact domain matching, failed/incomplete sync, late protection before archive, Jev uncertainty and LLM/decision separation. Run lint, typecheck, Pods build and relevant tests; full check:ci before live rollout. Keep permanent tests because accidental archival has significant consequences.
4. Merge after exact-head external CI and review. Connect authorized existing Jev test key through supported app control, replace the assigned companion with a new immutable program folder, restore only read permissions and assign Jev. Validate/activate the recipe; run preview and one-time scheduled grant acceptance without Telegram delivery or grant approval. Re-enable decision polling only with the new protection enforced. Expire old pending batches locally when the application binding changes; new proposals require fresh owner review. Keep the existing daily workflow.

## Progress

- 2026-09-26: Owner approved the proposed design; issue 1396 created. Existing decision polling disabled during upgrade (schedule revision 2). Existing Jev connection absent; owner authorized use of the test key in ~/Companies/private/repos/jev.

- Implementation complete; full lint/typecheck, Pods build and 592 tests passed. Real Jev test-key acceptance correctly classified five synthetic cases. Final review normalizes owner policy casing and completes summaries before creating grants. PR 154 merged at 84ccff34; signed/notarized f182add0 app and DMG acceptance passed, installed with all 14 Pods preserved. Jev native private-file connection is ready. The first real preview failed closed on Jev HTTP 400; high-entropy synthetic state reproduced max_tokens_exceeded. Follow-up branch bugfix/issue-1396-sent-delta-pages bounds state to 24 KB (below the 32k-token state-plus-question limit), requests Microsoft delta page size through Prefer, and logs synchronization progress. PR 155 merged at 7315a95c. The second native preview completed all 120 DOCPIT messages; Delta Mind exposed a split UTF-16 surrogate at the 6,000-character body boundary. Exact failing Jev request returned api_usage_error/invalid Unicode; normalizing only that boundary returned HTTP 200. Follow-up bugfix/issue-1396-mail-unicode preserves valid Unicode and retains the truncated flag. Final live acceptance remains.

## Decisions

- Enforce archive protection in the reviewed assigned companion, including its final move path, rather than trusting a model response or editable decision cache.
- Bootstrap all currently available Sent Items, then retain recipient union permanently. Deleted historical messages cannot be reconstructed; newly missing or invalid cursor causes a full rescan without discarding known contacts.
- No mailbox moves or extra Telegram briefing during verification.

## Rollback

Retain prior program assignment/source and script history. Disable decision polling on any unresolved protection failure. Do not reactivate the previous permissive archive path as a silent fallback. Existing paired signed app/profile backup remains available; a signed native update is required for the private-file Jev connection import and pending-batch expiry.

## Outcomes

Native installation and Jev connection completed. Final mailbox acceptance and re-enabled archive decision polling remain; see issue 1396 for final receipts.
