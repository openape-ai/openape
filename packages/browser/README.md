# @openape/browser

Grant-aware Playwright browser for OpenApe.

`@openape/browser` creates a Playwright browser context that intercepts outgoing HTTP(S) requests, evaluates them against allow/deny/grant rules, requests grants from an IdP when needed, and supports delegation login flows.

## Install

```bash
pnpm add @openape/browser
```

Install either `playwright` or `playwright-core` alongside this package.

## Exports

### `createGrantedBrowser(options: GrantedBrowserOptions): Promise<GrantedBrowser>`

Creates a browser context with route interception.

```ts
import { createGrantedBrowser } from '@openape/browser'

const browser = await createGrantedBrowser({
  agent: {
    email: 'agent@example.com',
    token: process.env.OPENAPE_TOKEN,
  },
  rules: {
    allow: ['docs.example.com/**'],
    grantRequired: [
      {
        pattern: 'admin.example.com/**',
        methods: ['GET', 'POST'],
        approval: 'once',
      },
    ],
    deny: ['admin.example.com/internal/**'],
  },
  defaultAction: 'deny',
})

const page = await browser.newPage()
await page.goto('https://docs.example.com')
await browser.close()
```

### `resolveIdpUrl(idp: string | undefined, agent: AgentConfig): string`

Returns the explicit `idp` URL when provided. Otherwise it derives an IdP URL from the agent email domain.

```ts
import { resolveIdpUrl } from '@openape/browser'

resolveIdpUrl(undefined, { email: 'agent@id.openape.ai' })
// https://id.openape.ai
```

### `evaluateRequest(url: string, method: string, rules: Rules, defaultAction?: DefaultAction): RouteDecision | { decision: 'grant_required', rule: GrantRule }`

Evaluates one request against the rule set.

```ts
import { evaluateRequest } from '@openape/browser'

const decision = evaluateRequest(
  'https://admin.example.com/settings',
  'POST',
  {
    grantRequired: [{ pattern: 'admin.example.com/**', methods: ['POST'] }],
  },
  'deny',
)
```

### `findGrantRule(url: string, method: string, rules?: (string | GrantRule)[]): GrantRule | null`

Returns the first matching grant rule for a URL and HTTP method.

### `matchesRuleList(url: string, rules?: (string | SimpleRule)[]): boolean`

Returns `true` when the URL matches any allow or deny rule in a list.

### `patternToRegExp(pattern: string): RegExp`

Converts an OpenApe browser rule pattern into a regular expression.

```ts
import { patternToRegExp } from '@openape/browser'

const re = patternToRegExp('*.example.com/admin/*')
re.test('https://app.example.com/admin/users')
// true
```

### `parseRulesFile(path: string): { default_action?: DefaultAction; rules: Rules }`

Reads a TOML rules file from disk and returns the parsed rules.

### `parseRulesToml(content: string): { default_action?: DefaultAction; rules: Rules }`

Parses TOML rule content from a string.

```ts
import { parseRulesToml } from '@openape/browser'

const parsed = parseRulesToml(`
default_action = "deny"

[[allow]]
pattern = "docs.example.com/**"

[[grant_required]]
pattern = "admin.example.com/**"
methods = ["POST"]
approval = "once"
`)
```

## Types

### `GrantedBrowser`

```ts
interface GrantedBrowser {
  context: BrowserContext
  newPage: () => Promise<Page>
  loginAs: (options: LoginAsOptions) => Promise<Page>
  close: () => Promise<void>
}
```

### `GrantedBrowserOptions`

```ts
interface GrantedBrowserOptions {
  agent: AgentConfig
  idp?: string
  rules?: Rules
  rulesFile?: string
  rulesFromIdp?: boolean
  defaultAction?: DefaultAction
  playwright?: Record<string, unknown>
  onGrantRequired?: (url: string) => Promise<'request' | 'deny'> | 'request' | 'deny'
  onGrantApproved?: (url: string, grantId: string) => void
  onGrantDenied?: (url: string) => void
}
```

### `AgentConfig`

```ts
interface AgentConfig {
  email: string
  key?: string
  token?: string
}
```

### `Rules`

```ts
interface Rules {
  allow?: (string | SimpleRule)[]
  deny?: (string | SimpleRule)[]
  grantRequired?: (string | GrantRule)[]
}
```

### `GrantRule`

```ts
interface GrantRule {
  pattern: string
  methods?: string[]
  approval?: 'once' | 'timed' | 'always'
  duration?: string
  includeBody?: boolean
}
```

### `SimpleRule`

```ts
interface SimpleRule {
  pattern: string
}
```

### `LoginAsOptions`

```ts
interface LoginAsOptions {
  as: string
  at: string
  delegationGrant: string
}
```

### `DefaultAction`

```ts
type DefaultAction = 'allow' | 'deny' | 'grant_required'
```

### `RouteDecision`

```ts
type RouteDecision = 'allow' | 'deny' | 'grant_required'
```

## Browser behavior

`createGrantedBrowser()`:

- launches Chromium through `playwright-core` or `playwright`
- creates one Playwright browser context
- intercepts `http://` and `https://` requests on each new page
- allows matching `allow` rules
- aborts matching `deny` rules with `blockedbyclient`
- requests and polls grants for matching `grantRequired` rules
- aborts requests when the grant is denied, revoked, times out, or the grant request fails

Non-HTTP requests such as `data:` and `blob:` continue without interception.

## Delegation login

Use `loginAs()` to navigate to a service provider login endpoint and inject a `delegation_grant` parameter into the IdP authorize redirect.

```ts
const page = await browser.loginAs({
  as: 'user@example.com',
  at: 'https://service.example.com',
  delegationGrant: 'grant_123',
})
```

## Rules file format

`parseRulesFile()` and `createGrantedBrowser({ rulesFile })` support a simple TOML format:

```toml
default_action = "deny"

[[allow]]
pattern = "docs.example.com/**"

[[deny]]
pattern = "internal.example.com/**"

[[grant_required]]
pattern = "admin.example.com/**"
methods = ["POST", "PUT"]
approval = "once"
duration = "15m"
include_body = true
```

Supported sections:

- `[[allow]]`
- `[[deny]]`
- `[[grant_required]]`

Supported `grant_required` fields:

- `pattern`
- `methods`
- `approval`
- `duration`
- `include_body`
