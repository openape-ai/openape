# Pinned o365 source

This reproducible source archive comes from the exact CLI commit recorded in
`o365-cli.json`. Changes belong in the separate o365 repository and its PR; refresh
the archive and hash only after reviewing that source. No local worktree files or
credentials are included. The archive is retained because the existing forge does
not expose an anonymous archive download for this revision, and package builds must
not acquire forge credentials.

macOS builds require Go 1.26.0, verify the archive digest, compile with the existing
locked modules and copy the binary, source provenance, digest and license status outside
ASAR. No executable is resolved from the user's PATH during pod execution. Linux
CI checks TypeScript contracts; actual native/runtime acceptance requires macOS.

The upstream README declares MIT, but the pinned revision has no LICENSE file.
The package records this explicitly; complete license notices remain a distribution
gate rather than silently supplying an invented notice.
