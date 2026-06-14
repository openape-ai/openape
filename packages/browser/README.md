# @openape/browser

`@openape/browser` wraps Playwright with OpenApe grant handling. It creates browser pages that evaluate outbound requests against allow, deny, and grant-required rules, requests approval from an IdP when needed, and supports delegation login flows.

## Install

Install the package together with Playwright or `playwright-core`.

```bash
pnpm add @openape/browser playwright
```

## Exports

The package exports:

- `createGrantedBrowser`
- `resolveIdpUrl`
- `evaluateRequest`
- `findGrantRule`
- `matchesRuleList`
- `patternToRegExp`
- `parseRulesFile`
- `parseRulesToml`
- types: `AgentConfig`, `DefaultAction`, `GrantedBrowser`, `GrantedBrowserOptions`, `GrantRule`, `LoginAsOptions`, `RouteDecision`, `RuleApproval`, `Rules`, `SimpleRule`

## Create a granted browser

Use `createGrantedBrowser` to launch Chromium, create a Playwright browser context, and attach route interception to each page.

```ts
import { createGrantedBrowser } from '@openape/browser'

const browser = await createGrantedBrowser({
  agent: {
    email: 'agent@example.com',
    token: process.env.OPENAPE_TOKEN,
  },
  idp: 'https://id.openape.ai',
  defaultAction: 'deny',
  rules: {
    allow: ['docs.example.com'],
    deny: ['ads.example.com'],
    grantRequired: [
      {
        pattern: 'bank.example.com/api/transfer',
        methods: ['POST'],
        approval: 'once',
        includeBody: true,
      },
    ],
  },
})

const page = await browser.newPage()
await page.goto('https://docs.example.com')
await browser.close()
```

`createGrantedBrowser(options)` returns a `GrantedBrowser` with:

- `context`: the underlying Playwright `BrowserContext`
- `newPage()`: creates a page and installs request interception
- `loginAs(options)`: opens `/api/login` on a service provider and injects `delegation_grant` into the IdP authorize redirect
- `close()`: closes the context and browser

If neither `playwright-core` nor `playwright` is installed, `createGrantedBrowser` throws an error.

## Options

### `agent`

`agent` is required.

```ts
{
  email: string
  key?: string
  token?: string
}
```

The package uses `agent.token` as a bearer token for IdP grant API requests.

### `idp`

`idp` sets the IdP base URL explicitly. If you omit it, the package derives the URL from the domain part of `agent.email`.

```ts
resolveIdpUrl(undefined, { email: 'agent+user@id.openape.ai' })
// => 'https://id.openape.ai'
```

### `rules`

`rules` defines in-memory request rules.

```ts
{
  allow?: (string | { pattern: string })[]
  deny?: (string | { pattern: string })[]
  grantRequired?: (string | {
    pattern: string
    methods?: string[]
    approval?: 'once' | 'timed' | 'always'
    duration?: string
    includeBody?: boolean
  })[]
}
```

Rule evaluation order is:

1. deny list
2. grant-required rules
3. allow list
4. `defaultAction`

If `defaultAction` is `'grant_required'`, unmatched requests produce a grant-required decision with `{ pattern: '*' }`.

### `rulesFile`

`rulesFile` loads rules from a TOML file. When present, the parsed file replaces the in-memory `rules` object and can also set `default_action`.

Supported sections:

- `[[allow]]`
- `[[deny]]`
- `[[grant_required]]`
- root-level `default_action = "allow" | "deny" | "grant_required"`

Example:

```toml
default_action = "deny"

[[allow]]
pattern = "docs.example.com"

[[grant_required]]
pattern = "bank.example.com/api/transfer"
methods = ["POST"]
approval = "once"
include_body = true
```

Load it with:

```ts
const browser = await createGrantedBrowser({
  agent: { email: 'agent@example.com', token: '...' },
  rulesFile: './browser-rules.toml',
})
```

### `defaultAction`

`defaultAction` sets the fallback decision for requests that do not match any rule.

Supported values:

- `'allow'`
- `'deny'`
- `'grant_required'`

If omitted, the package uses `'deny'`.

### `playwright`

`playwright` passes launch options to `playwright.chromium.launch(...)`.

### Grant callbacks

Use callbacks to decide whether to request a grant and to react to the outcome.

```ts
const browser = await createGrantedBrowser({
  agent: { email: 'agent@example.com', token: '...' },
  rules: { grantRequired: ['secure.example.com'] },
  onGrantRequired: async (url) => {
    console.log('Grant required:', url)
    return 'request'
  },
  onGrantApproved: (url, grantId) => {
    console.log('Approved', grantId, url)
  },
  onGrantDenied: (url) => {
    console.log('Denied', url)
  },
})
```

- `onGrantRequired(url)` returns `'request'` or `'deny'`
- `onGrantApproved(url, grantId)` runs after approval
- `onGrantDenied(url)` runs when the user declines, the request fails, or approval times out

## Request handling

For each intercepted HTTP or HTTPS request, the package:

1. evaluates the request URL and method against the configured rules
2. continues the request for `allow`
3. aborts the request with `blockedbyclient` for `deny`
4. requests a grant for `grant_required`
5. polls the IdP until the grant is approved, denied, revoked, or times out

Non-HTTP(S) requests such as `data:` and `blob:` continue without interception.

When a grant-required rule sets `includeBody: true`, the package hashes `request.postData()` with SHA-256 and sends the hash as `metadata.body_hash` in the grant request.

## Delegation login

Use `loginAs` to start a service-provider login flow with a delegation grant.

```ts
const page = await browser.loginAs({
  as: 'user@example.com',
  at: 'https://app.example.com',
  delegationGrant: 'grant_123',
})
```

`loginAs`:

- creates a new page
- intercepts `**/authorize*`
- appends `delegation_grant` to the authorize URL
- opens `${at}/api/login?email=${as}`
- removes the authorize interceptor after navigation completes

## Rule helpers

Use the exported helpers when you need the package's rule semantics outside the browser wrapper.

### `patternToRegExp(pattern)`

Converts a rule pattern into a case-insensitive regular expression that matches both `http` and `https` URLs.

Pattern behavior:

- `*` matches a single path or domain segment
- `**` matches multiple path segments
- `example.com` matches the domain and any path on that domain
- `example.com/admin/*` matches paths under `/admin/`

### `matchesRuleList(url, rules)`

Returns `true` when any rule in a list matches the URL.

### `findGrantRule(url, method, rules)`

Returns the first matching grant rule for the URL and HTTP method, or `null`.

### `evaluateRequest(url, method, rules, defaultAction?)`

Returns:

- `'allow'`
- `'deny'`
- `{ decision: 'grant_required', rule: GrantRule }`

### `parseRulesToml(content)` and `parseRulesFile(path)`

Parse TOML rule content or a TOML file into:

```ts
{
  default_action?: 'allow' | 'deny' | 'grant_required'
  rules: {
    allow?: { pattern: string }[]
    deny?: { pattern: string }[]
    grantRequired?: GrantRule[]
  }
}
```
