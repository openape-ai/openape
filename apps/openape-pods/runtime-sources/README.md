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

Installed executables are hash-pinned when assigned; updates require selecting the
installed replacement in Permissions. Pods ships no Shapes adapters (issue 1473,
revision 4): the IdP resolves every program call with the shapes registry, and the
desktop builds the fixed permission details of its own operations (`pod-runtime`,
`pod-http`, `pod-ssh`) itself. Graphical apps are called by a launcher name of
their own without arguments.
