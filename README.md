# OpenApe Examples

Example applications and end-to-end tests for the OpenApe ecosystem.

```
                         ┌─────────────────────────┐
                         │     Identity Provider    │
                         │    (openape-idp-example) │
                         │       localhost:3000      │
                         │                           │
                         │  WebAuthn · DDISA · Grants │
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
- [`e2e/`](e2e/) — End-to-end tests

## Quick Start (Local)

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
NUXT_OPENAPE_URL=http://localhost:3000 pnpm dev
```

> **Note:** `NUXT_OPENAPE_URL` is required for local dev because DDISA DNS discovery can't resolve localhost. In production, leave it empty to use DNS discovery.

### 4. Try the full flow

1. Open **http://localhost:3001**
2. Enter `demo@example.com` and click "Login with DDISA"
3. Authenticate with your passkey on the IdP
4. You are redirected back to the SP dashboard with your assertion claims

## Production Deployment (Vercel)

### Overview

Both apps deploy as Vercel Serverless Functions using the prebuilt workflow:

```
nuxt build → vercel build --prod → vercel deploy --prebuilt --prod
```

### Environment Variables

#### Identity Provider (`openape-idp-example`)

**Build-time** (passed to `nuxt build`):

| Variable | Description | Example |
| --- | --- | --- |
| `NUXT_OPENAPE_RP_ID` | WebAuthn Relying Party ID (= domain) | `id.example.com` |
| `NUXT_OPENAPE_RP_ORIGIN` | WebAuthn origin (= full URL) | `https://id.example.com` |
| `NUXT_OPENAPE_ISSUER` | JWT issuer (= IdP URL) | `https://id.example.com` |
| `NUXT_OPENAPE_MANAGEMENT_TOKEN` | API token for admin endpoints | `<random-string>` |
| `NUXT_OPENAPE_ADMIN_EMAILS` | Comma-separated admin emails | `admin@example.com` |
| `NUXT_OPENAPE_STORAGE_DRIVER` | `s3` for production, empty for local fs | `s3` |
| `NUXT_OPENAPE_S3_ACCESS_KEY` | S3 access key | |
| `NUXT_OPENAPE_S3_SECRET_KEY` | S3 secret key | |
| `NUXT_OPENAPE_S3_BUCKET` | S3 bucket name | `my-bucket` |
| `NUXT_OPENAPE_S3_ENDPOINT` | S3 endpoint URL | `https://s3.example.com` |
| `NUXT_OPENAPE_S3_REGION` | S3 region | `us-east-1` |
| `NUXT_OPENAPE_S3_PREFIX` | Key prefix in bucket | `openape-idp/` |

**Vercel runtime** (set via `vercel env add`):

Nitro auto-maps runtime config keys to env vars using the pattern `NUXT_<SNAKE_CASE_PATH>`. For the IdP module (`openapeIdp.*`), this means:

| Vercel Env Var | Maps to |
| --- | --- |
| `NUXT_OPENAPE_IDP_RP_ID` | `openapeIdp.rpID` |
| `NUXT_OPENAPE_IDP_RP_ORIGIN` | `openapeIdp.rpOrigin` |
| `NUXT_OPENAPE_IDP_ISSUER` | `openapeIdp.issuer` |
| `NUXT_OPENAPE_IDP_MANAGEMENT_TOKEN` | `openapeIdp.managementToken` |
| `NUXT_OPENAPE_IDP_ADMIN_EMAILS` | `openapeIdp.adminEmails` |
| `NUXT_OPENAPE_IDP_STORAGE_DRIVER` | `openapeIdp.storageDriver` |
| `NUXT_OPENAPE_IDP_S3_ACCESS_KEY_ID` | `openapeIdp.s3.accessKeyId` |
| `NUXT_OPENAPE_IDP_S3_SECRET_ACCESS_KEY` | `openapeIdp.s3.secretAccessKey` |
| `NUXT_OPENAPE_IDP_S3_BUCKET` | `openapeIdp.s3.bucket` |
| `NUXT_OPENAPE_IDP_S3_ENDPOINT` | `openapeIdp.s3.endpoint` |
| `NUXT_OPENAPE_IDP_S3_REGION` | `openapeIdp.s3.region` |
| `NUXT_OPENAPE_IDP_S3_PREFIX` | `openapeIdp.s3.prefix` |

> **Important:** The build-time env var names (e.g. `NUXT_OPENAPE_S3_ACCESS_KEY`) differ from the Nitro runtime mapping names (e.g. `NUXT_OPENAPE_IDP_S3_ACCESS_KEY_ID`). You need both: build-time vars for `nuxt build`, and Vercel env vars for runtime override. Alternatively, set only the Vercel runtime vars and accept the defaults at build time — but then build with the correct Nitro-mapped names.

#### Service Provider (`openape-sp-example`)

| Variable | Description | Example |
| --- | --- | --- |
| `NUXT_OPENAPE_SP_ID` | SP identifier (= domain) | `sp.example.com` |
| `NUXT_OPENAPE_SP_NAME` | Display name | `My Service` |
| `NUXT_OPENAPE_SP_SESSION_SECRET` | Cookie signing secret (>=32 chars) | `<random-string>` |
| `NUXT_OPENAPE_URL` | IdP URL override. Leave empty for DNS discovery! | *(empty)* |

**Nitro runtime mapping** for SP (`openapeSp.*`):

| Vercel Env Var | Maps to |
| --- | --- |
| `NUXT_OPENAPE_SP_SP_ID` | `openapeSp.spId` |
| `NUXT_OPENAPE_SP_SP_NAME` | `openapeSp.spName` |
| `NUXT_OPENAPE_SP_SESSION_SECRET` | `openapeSp.sessionSecret` |
| `NUXT_OPENAPE_SP_OPENAPE_URL` | `openapeSp.openapeUrl` |

### DDISA DNS Discovery

The SP discovers the IdP via DNS. For domain `example.com`, set a TXT record:

```
_ddisa.example.com  TXT  "v=ddisa1 idp=https://id.example.com; mode=open"
```

When `NUXT_OPENAPE_URL` / `openapeSp.openapeUrl` is empty, the SP extracts the domain from the user's email and queries `_ddisa.<domain>`. If no record is found, login returns 404.

For local development, set `NUXT_OPENAPE_URL=http://localhost:3000` since DNS can't resolve localhost domains.

### S3 Storage (S3-compatible providers)

The IdP uses unstorage with an S3 driver. For S3-compatible providers (Exoscale SOS, MinIO, etc.) that don't send an XML prolog in responses, a patch is applied automatically via `pnpm patchedDependencies`. No manual steps required — `pnpm install` handles everything.

### Deploy Script

Full deployment for both apps:

```bash
#!/bin/bash
set -e

# --- IdP ---
cd apps/openape-idp-example

# 1. ALWAYS delete cached env (stale values get baked into build!)
rm -f .vercel/.env.production.local

# 2. Build with env vars
NUXT_OPENAPE_RP_ID=id.example.com \
NUXT_OPENAPE_RP_ORIGIN=https://id.example.com \
NUXT_OPENAPE_ISSUER=https://id.example.com \
NUXT_OPENAPE_MANAGEMENT_TOKEN=<token> \
NUXT_OPENAPE_ADMIN_EMAILS=admin@example.com \
NUXT_OPENAPE_STORAGE_DRIVER=s3 \
NUXT_OPENAPE_S3_ACCESS_KEY=<key> \
NUXT_OPENAPE_S3_SECRET_KEY=<secret> \
NUXT_OPENAPE_S3_BUCKET=<bucket> \
NUXT_OPENAPE_S3_ENDPOINT=<endpoint> \
NUXT_OPENAPE_S3_REGION=<region> \
NUXT_OPENAPE_S3_PREFIX=<prefix>/ \
npx nuxt build

# 3. Vercel build + deploy
vercel build --prod
vercel deploy --prebuilt --prod --yes

# --- SP ---
cd ../openape-sp-example
rm -f .vercel/.env.production.local

NUXT_OPENAPE_SP_ID=sp.example.com \
NUXT_OPENAPE_SP_NAME="My Service" \
NUXT_OPENAPE_SP_SESSION_SECRET=<secret-min-32-chars> \
npx nuxt build

vercel build --prod
vercel deploy --prebuilt --prod --yes
```

### First User Registration

After deploying the IdP, create a registration URL:

```bash
curl -X POST https://id.example.com/api/admin/registration-urls \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <management-token>" \
  -d '{"email":"user@example.com","name":"User Name","expiresInHours":48}'
```

Open the returned `registrationUrl` in a browser to register a passkey.

### Admin Access

Users listed in `NUXT_OPENAPE_ADMIN_EMAILS` (comma-separated) get admin access after logging in. Admins can:

- Create registration URLs
- Manage users and agents
- Approve/deny grant requests

The management token (`NUXT_OPENAPE_MANAGEMENT_TOKEN`) provides API-only admin access without a session (via `Authorization: Bearer <token>` header).

### Deployment Pitfalls

#### 1. `vercel build` caches env vars locally

`vercel build --prod` downloads Vercel env vars into `.vercel/.env.production.local` and caches them. After changing or deleting Vercel env vars, you **must** delete this file before rebuilding:

```bash
rm -f .vercel/.env.production.local
```

Otherwise stale values get baked into the Nuxt build.

#### 2. Build-time vs Runtime env var names differ

Nitro maps `runtimeConfig` keys to env vars using `snakeCase()` on the full config path:

- `nuxt.config.ts` reads: `process.env.NUXT_OPENAPE_S3_ACCESS_KEY` (build-time)
- Nitro runtime maps: `openapeIdp.s3.accessKeyId` → `NUXT_OPENAPE_IDP_S3_ACCESS_KEY_ID` (runtime)

These are **different names!** For Vercel, set both the build-time env vars (used during `nuxt build`) and the Nitro-mapped env vars (used at runtime by the serverless function).

#### 3. SP: `openapeUrl` must default to empty string

In `nuxt.config.ts`, use `?? ''` (not `|| 'http://localhost:3000'`):

```ts
openapeUrl: process.env.NUXT_OPENAPE_URL ?? '',
```

Empty string = DNS discovery active. `|| 'fallback'` would override empty strings.

#### 4. Vercel Deployment Protection

If using Vercel Deployment Protection, add custom domains as project domains (not just aliases) and set protection to `all_except_custom_domains`. Otherwise API requests to the custom domain may be blocked.

## End-to-End Tests

```bash
cd e2e
pnpm install
pnpm test
```

## Known Issues

- **unstorage S3 XML parsing:** S3-compatible providers (Exoscale SOS, MinIO) may not send an XML prolog. This is fixed via `pnpm patchedDependencies` — applied automatically on `pnpm install`.

## More Information

Full documentation: [docs.openape.at](https://docs.openape.at)
All packages: [root README](../README.md)

## License

[MIT](./LICENSE)
