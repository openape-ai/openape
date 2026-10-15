---
"@openape/nest": major
"@openape/apes": major
"@openape/ape-troop": major
"@openape/ape-agent": major
---

Retire OpenClaw integration. Nest and agent provisioning support only the bridge runtime; legacy unsupported registry entries remain stored but cannot start. Remove the OpenClaw setup and grant-gate packages and their distribution tooling. Imported skill requirements now use metadata.openape; metadata.openclaw is rejected with migration guidance. Generic DDISA, grant authorization and CLI extensions remain available.
