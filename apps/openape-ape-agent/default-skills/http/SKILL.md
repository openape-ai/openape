---
name: http
description: When the user asks to fetch a webpage, hit a REST API, or POST JSON to an endpoint, use the http.get / http.post tools — never invent URLs.
metadata:
  openape:
    requires_tools: [http.get]
---

# HTTP fetch

## When to use

- `http.get` — read content from any HTTPS URL (webpages, REST endpoints, JSON APIs)
- `http.post` — POST JSON to an HTTPS URL

Both are bounded:

- Response capped at 1 MB (anything longer is truncated)
- Headers go through a deny-list (no `Authorization` for arbitrary hosts, no `Cookie`)
- HTTP-only URLs are rejected — HTTPS required

For commands that go beyond simple HTTP (auth, mTLS, complex curl flags, multipart upload), use the `bash` tool with `curl` instead.

## Patterns

Fetch JSON:

```
http.get({
  "url": "https://api.example.com/users/42",
  "headers": { "Accept": "application/json" }
})
```

POST JSON:

```
http.post({
  "url": "https://api.example.com/notes",
  "body": { "title": "from agent", "body": "..." },
  "headers": { "Content-Type": "application/json" }
})
```

## Anti-patterns

- Don't synthesize URLs ("I think it's at /api/v1/foo") — ask the user for the exact endpoint or use `http.get` only after you've seen it in their message or in a tool result.
- Don't paginate by manually incrementing offsets without checking the API's actual contract — read response shape first.
- For auth that needs `Authorization: Bearer …`, the deny-list strips it. Use `bash` with `curl` if you need it.
