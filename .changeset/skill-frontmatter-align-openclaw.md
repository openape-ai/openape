---
"@openape/ape-agent": minor
---

Align SKILL.md frontmatter with OpenClaw's nested-metadata pattern so a clawhub.ai-published skill drops into our runtime without modification.

**New supported shapes** (back-compat to the flat legacy form):

```yaml
metadata:
  openclaw:
    requires:
      bins: [o365-cli]        # host-PATH binary eligibility
  openape:
    requires_tools: [mail.list]  # our tool-whitelist eligibility
```

The parser now uses the `yaml` package (added as a runtime dep) instead of a hand-rolled regex pass, so nested YAML structures Just Work. Reads:

- `metadata.openape.requires_tools` (canonical for us)
- `metadata.openclaw.requires.bins` (canonical for OpenClaw — we honor it as binary-eligibility)
- legacy top-level `requires_tools` (existing skills keep parsing)

**Binary eligibility** (`requires_bins`) is new: skills declaring a host CLI prerequisite get filtered out when the binary isn't on PATH. Reuses the bundled `mail` skill's case — the o365-cli binary may not be installed on every agent host.

Default-skills updated to the namespaced form as a reference; existing user-written skills continue to parse with either shape.
