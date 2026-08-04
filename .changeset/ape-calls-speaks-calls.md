---
'@openape/ape-calls': patch
---

`list`/`show`/`wait` fold the call vocabulary: a `call.raised` counts as open, `call.answered` resolves it and its `answer` is what `wait` prints. Before this, a card answered via the new vocabulary showed as open and `wait` printed an empty line.
