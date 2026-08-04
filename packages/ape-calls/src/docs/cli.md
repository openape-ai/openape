# ape-calls

Answer-waiting for OpenApe calls — the decisions a human still owes an agent.

```
ape-calls list                    what is waiting, longest-waiting first
ape-calls show <id>               one call, its proofs, its answer
ape-calls wait <id> [--timeout 2h]  block until answered; prints the answer
ape-calls whoami                  which identity this device uses
```

Login once per device with `apes login <email>` — the same session covers
ape-pr, ape-tasks, ape-testruns and the rest.

Exit codes for `wait`: **0** answered, **2** expired without an answer,
**3** your timeout ran out.
