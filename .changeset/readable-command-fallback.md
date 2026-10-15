---
"@openape/nuxt-auth-idp": patch
---

Grant cards and batch rows of a command without a registry adapter read better.
The card shows the program and its subcommands, each canonical JSON-object
argument as a key/value list and other arguments as a list; the raw command line
moves to the technical details. A batch row shows the head and the first
arguments as compact facts with middle-truncated values; rows that would read
the same add the first fact in which they differ, or keep the raw line. What an
approval binds is unchanged. The batch page decides only open members; already
decided members move into a closed "Already decided" history, newest first.
