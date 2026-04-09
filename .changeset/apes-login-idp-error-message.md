---
'@openape/apes': patch
---

fix(apes): clearer error when `apes login` cannot discover an IdP

When the DDISA DNS lookup fails and no `--idp` / `APES_IDP` / config default is set, the error now lists three concrete options with self-hosting as the recommended path and OpenApe's hosted IdP as an opt-in testing fallback.
