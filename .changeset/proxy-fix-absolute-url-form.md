---
"@openape/proxy": patch
---

proxy: accept the standard `HTTP_PROXY` absolute-URL request line

`createNodeHandler.handleRequest` previously only understood the legacy
path-encoded form (`http://proxy:port/<full-target-url>`). Standard
HTTP_PROXY clients — curl, gh, git, npm, undici — send the target as an
absolute URL in the request line: `GET http://example.com/path HTTP/1.1`,
which `node:http` surfaces as `req.url = "http://example.com/path"`. The
old code concatenated this with the proxy's own host header, producing
garbage like `http://proxy:portshttp://example.com/path` → "Invalid target
URL" 400.

Fix: detect when `req.url` is already absolute and prefix it with a slash
so the existing `pathname.slice(1)` extraction recovers the same target
string. Path-form clients (legacy) keep working unchanged.

Net effect: `apes proxy -- curl http://example.com` returns HTTP 200
instead of "Invalid target URL". HTTPS-via-CONNECT was unaffected (uses
`handleConnect`, not `handleRequest`).
