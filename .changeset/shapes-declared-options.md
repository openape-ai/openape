---
"@openape/grants": minor
"@openape/shapes": minor
---

Shapes adapters can declare option values and global options. An operation with
`value_options` binds a value only for declared options (`value_options` and
`required_options`); other options are flags, so `merge-base --is-ancestor A B`
keeps both positionals. `[cli] global_options` (for example `["C=repo"]` for
`git -C <path>`) are accepted before the command prefix and bound for every
operation. Operations without `value_options` derive the same permissions as before.
