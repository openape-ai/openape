---
"@openape/apes": patch
---

fix(coding): loopback LiteLLM needs no key; push via inline token URL

Two changes that let the coding agent run hands-free:

- `apes agents code` no longer requires `LITELLM_API_KEY` when
  `LITELLM_BASE_URL` is loopback (127.0.0.1/localhost/[::1]). A LiteLLM
  proxy bound to loopback can run keyless, so an agent needs no litellm
  config at all (the default base is loopback). A remote base still needs
  a key.
- The coding loop pushes GitHub branches with an inline token URL
  (`https://x-access-token:$GH_TOKEN@github.com/<owner/name>.git`,
  expanded by the gated shell so the token never enters argv) plus
  `GIT_TERMINAL_PROMPT=0` — so the push authenticates non-interactively
  and fails fast instead of hanging on a credential prompt. Non-GitHub
  forges keep their CLI's own auth via `origin`.
