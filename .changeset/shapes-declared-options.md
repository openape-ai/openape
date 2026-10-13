---
"@openape/grants": minor
"@openape/shapes": minor
---

Shapes adapters can declare their options and global options. An operation with
`value_options` or `flag_options` accepts only declared options: value options
bind the next token, flag options are flags, and any other option makes the
operation not match (fail closed for options such as git `--upload-pack`).
Declared and global options must use their exact dash form (`--name`, `-x`;
bundles only of declared one-letter flags), so
`merge-base --is-ancestor A B` keeps both positionals. `[cli] global_options`
(for example `["C=repo"]` for `git -C <path>`) are accepted once before the
command prefix and bound for every operation. Operations without these fields
derive the same permissions as before.
