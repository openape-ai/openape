# ape-calls — for agents

A **call** is a decision waiting for a human: a question with options, an
escalation, or a pull request awaiting a verdict. Calls live in troop's
attention log; the human answers them at https://troop.openape.ai/inbox.

## Waiting for an answer

```
ape-calls wait <id> --timeout 2h
```

Blocks until the call is answered, prints the answer (`merge`, `rework`,
or the chosen option) and exits 0. Exits **2** if the call expired without an
answer, **3** if your timeout ran out first.

The wait is a long-poll, not a busy loop: troop holds the request until the
human clicks, so the answer arrives within a second.

**Do not block a whole agent run on this.** A human may take hours. Park the
work — remember the call id, end the turn — and `wait` only when you know the
human is at the keyboard, or in a short-lived helper process.

## Seeing what is open

```
ape-calls list            # oldest first — the top one blocks the longest
ape-calls show <id>       # one call with its proofs and its answer
```

## Raising a call

Calls are raised by the tool that does the work:
`ape-pr upload --task-ref …` raises a verdict call for a pull request, and
`ape-testruns upload --task-ref …` attaches its report as proof to the same
task. Use the same `--task-ref` everywhere so one card gathers every proof.
