---
'@openape/cli-auth': patch
---

Honor the per-request endpoint override in the SP token exchange. `apiCall` previously resolved the exchange target without the request's `endpoint` option, so `--endpoint` flags still exchanged against the default (prod) endpoint. The cached SP token is now also only reused when it was minted at the requested endpoint.
