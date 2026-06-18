# @openape/idp-test-suite

`@openape/idp-test-suite` provides reusable Vitest suites and helpers for testing an OpenAPE IdP deployment.

## Install

```bash
pnpm add -D @openape/idp-test-suite
```

## What it exports

### `runIdPTestSuite(config)`

Registers the package's built-in Vitest suites for an IdP instance.

```ts
import { runIdPTestSuite } from '@openape/idp-test-suite'

runIdPTestSuite({
  baseUrl: 'http://localhost:3000',
  managementToken: process.env.MANAGEMENT_TOKEN!,
})
```

By default, the suite registers tests for:

- OIDC discovery
- admin users
- SSH keys
- challenge-response authentication
- browser sessions
- OIDC authorization flow
- grants
- delegations
- server-side policy shift
- safe commands
- security headers and caching

### `IdPTestConfig`

`runIdPTestSuite` accepts this config shape:

```ts
interface IdPTestConfig {
  baseUrl: string | (() => string)
  managementToken: string
  skip?: string[]
}
```

- `baseUrl` sets the IdP base URL. It can be a string or a function that resolves the URL at test time.
- `managementToken` is used by suites that call management endpoints.
- `skip` omits named suites. Supported names are:
  - `discovery`
  - `admin-users`
  - `ssh-keys`
  - `auth`
  - `session`
  - `oidc-flow`
  - `grants`
  - `delegations`
  - `server-policy-shift`
  - `safe-commands`
  - `security`

Example:

```ts
runIdPTestSuite({
  baseUrl: () => process.env.OPENAPE_IDP_URL!,
  managementToken: process.env.MANAGEMENT_TOKEN!,
  skip: ['safe-commands', 'server-policy-shift'],
})
```

## Helper exports

### `generateEd25519Key()`

Creates an Ed25519 key pair and returns:

- `publicKeySsh`: an SSH-formatted public key string
- `privateKey`: a Node.js `KeyObject`

### `loginWithKey(baseUrl, email, privateKey)`

Authenticates with the IdP challenge-response flow and returns a bearer token.

### `sessionLogin(baseUrl, email, privateKey)`

Authenticates with the session login endpoint and returns the `Set-Cookie` headers from the response.

### `CookieJar`

Stores cookies per origin and builds a `Cookie` header for follow-up requests.

```ts
const jar = new CookieJar()
jar.capture('http://localhost:3000/api/session/login', setCookieHeaders)
const cookie = jar.headerFor('http://localhost:3000/authorize')
```

### HTTP helpers

- `post(baseUrl, path, body, auth?)`
- `get(baseUrl, path, auth?)`
- `del(baseUrl, path, auth?)`

These helpers call the IdP, parse JSON responses when possible, and otherwise return the raw response text.

## Usage with Vitest

Create a test file that imports the suite and runs it:

```ts
import { runIdPTestSuite } from '@openape/idp-test-suite'

runIdPTestSuite({
  baseUrl: 'http://localhost:3000',
  managementToken: process.env.MANAGEMENT_TOKEN!,
})
```

Then run Vitest in your project.
