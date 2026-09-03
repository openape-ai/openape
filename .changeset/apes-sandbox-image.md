---
"@openape/apes-openclaw": patch
---

Add the public agent sandbox image (`compose/apes-sandbox.Dockerfile`,
`scripts/publish-sandbox-image.sh`): a Node 22 Debian base with the apes CLIs
pre-installed, running as the non-root `sandbox` user that OpenClaw's bind
targets assume. Account-specific tooling stays in a local `FROM` layer.
