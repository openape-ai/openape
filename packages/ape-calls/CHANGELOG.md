# @openape/ape-calls

## 0.1.1

### Patch Changes

- 2e1e2a0: `list`/`show`/`wait` fold the call vocabulary: a `call.raised` counts as open, `call.answered` resolves it and its `answer` is what `wait` prints. Before this, a card answered via the new vocabulary showed as open and `wait` printed an empty line.
- Updated dependencies [dd0d9ac]
  - @openape/proof-cli@0.2.0
