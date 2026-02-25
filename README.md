# OpenApe Examples

Example applications and end-to-end tests for the OpenApe ecosystem.

```
                         ┌─────────────────────────┐
                         │     Identity Provider    │
                         │    (openape-idp-example) │
                         │       localhost:3000      │
                         │                           │
                         │  WebAuthn · OIDC · Grants │
                         └────────┬──────────────────┘
                                  │
                          authorize / token
                                  │
                         ┌────────▼──────────────────┐
                         │     Service Provider       │
                         │    (openape-sp-example)    │
                         │       localhost:3001        │
                         │                             │
                         │  DDISA Login · Grant Access │
                         └─────────────────────────────┘
```

## Structure

- [`apps/openape-idp-example/`](apps/openape-idp-example/) — Identity Provider example (Nuxt)
- [`apps/openape-sp-example/`](apps/openape-sp-example/) — Service Provider example (Nuxt)
- `e2e/` — End-to-end tests

## Quick Start

### 1. Start the Identity Provider

```bash
cd apps/openape-idp-example
pnpm install
NUXT_OPENAPE_MANAGEMENT_TOKEN=my-token pnpm dev
```

### 2. Create the first user

In a second terminal:

```bash
cd apps/openape-idp-example
NUXT_OPENAPE_MANAGEMENT_TOKEN=my-token node create-registration-url.js demo@example.com "Demo User"
```

Open the printed URL in your browser and register a passkey.

### 3. Start the Service Provider

In a third terminal:

```bash
cd apps/openape-sp-example
pnpm install
pnpm dev
```

### 4. Try the full flow

1. Open **http://localhost:3001**
2. Enter `demo@example.com` and click "Login with DDISA"
3. Authenticate with your passkey on the IdP
4. You are redirected back to the SP dashboard with your OIDC claims

## License

MIT
