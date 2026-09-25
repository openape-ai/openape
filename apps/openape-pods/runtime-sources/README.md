# Runtime sources and test fixtures

Electron/Node.js, Codex, ape-shell and the native confinement helper are required
Pod runtime components. Applications such as o365-cli are selected from the Mac;
they are not built, downloaded or copied into the distributed app.

The pinned o365 archive and descriptor are legacy protocol test fixtures only.
Native tests build them into `.artifacts/o365-fixture` with Go 1.26.0, verify the
archive digest and use synthetic accounts against local TLS services. They never
enter `dist` or a release package. The archive records the exact upstream revision
in `o365-cli.json`; update it only after reviewing the upstream change. No local
worktree or credentials are included. Its missing upstream LICENSE does not
become a production redistribution dependency because the fixture is not shipped.

Installed executables and their apes descriptors are hash-pinned when assigned.
Updates require selecting the installed replacement in Permissions. A descriptor
already installed for ape-shell is detected automatically; otherwise the owner
selects the descriptor file. Graphical apps get an exact, no-argument launcher.
