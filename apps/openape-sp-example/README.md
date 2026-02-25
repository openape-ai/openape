# OpenApe SP Example

Service Provider example built with [Nuxt](https://nuxt.com/) and the `@openape/nuxt-auth-sp` module.

Demonstrates DNS-delegated (DDISA) login via an OpenApe Identity Provider and grant-based access control.

## Quick Start

```bash
pnpm install
pnpm dev
```

The SP is now running at **http://localhost:3001**.

> **Prerequisite:** The IdP must be running at `http://localhost:3000` with at least one registered user. See the [IdP example README](../openape-idp-example/README.md) for setup instructions.

## Login Flow

1. Open `http://localhost:3001` and enter the user's email address
2. The SP discovers the IdP via DNS-delegated identity (DDISA)
3. You are redirected to the IdP's `/authorize` endpoint
4. Authenticate with your passkey on the IdP
5. The IdP redirects back to the SP with an authorization code
6. The SP exchanges the code for tokens and shows the dashboard

## Pages

| Path | Description |
|------|-------------|
| `/` | Login — enter email to start the DDISA auth flow |
| `/dashboard` | Protected dashboard — shows OIDC claims and grant controls |

## Server API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/login` | Initiates the DDISA login flow (provided by module) |
| `GET` | `/api/callback` | OIDC callback — exchanges code for tokens (provided by module) |
| `GET` | `/api/me` | Returns current session claims (provided by module) |
| `GET` | `/api/grant-status` | Checks if an AuthZ-JWT exists in the session |
| `GET` | `/api/grant-callback` | Receives the IdP redirect after grant approval/denial |
| `POST` | `/api/request-permission` | Creates a grant request on the IdP |
| `POST` | `/api/protected-action` | Verifies the AuthZ-JWT and executes a protected action |
| `GET` | `/.well-known/sp-manifest.json` | SP manifest (provided by module) |

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `NUXT_OPENAPE_SP_ID` | `'sp.example.com'` | SP identifier (domain) |
| `NUXT_OPENAPE_SP_NAME` | `'OpenApe Service Provider'` | SP display name |
| `NUXT_OPENAPE_SP_SESSION_SECRET` | `'change-me-sp-secret-...'` | Session signing secret |
| `NUXT_OPENAPE_URL` | `'http://localhost:3000'` | URL of the Identity Provider |
