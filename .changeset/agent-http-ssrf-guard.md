---
"@openape/agent-runtime": patch
---

Add an SSRF guard to the agent `http.get`/`http.post` tools: validate the URL scheme, DNS-resolve the host and reject private/loopback/link-local/CGNAT/ULA/cloud-metadata targets, and re-validate every redirect hop (manual redirect following). Prevents a prompt-injected agent from reaching internal infrastructure via the HTTP tool.
