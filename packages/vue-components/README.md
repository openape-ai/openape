# @openape/vue-components

Vue 3 components, composables, and helpers for OpenApe identity and grant flows.

## Install

```bash
pnpm add @openape/vue-components
```

In the OpenApe monorepo, use the workspace package:

```json
{
  "dependencies": {
    "@openape/vue-components": "workspace:*"
  }
}
```

## What it exports

- `IdpLoginForm`
- `IdpGrantApproval`
- `IdpEnrollConfirm`
- `useIdpAuth`
- `useKeyLogin`
- `formatCliResourceChain`
- `formatWidenedPreview`
- `getCliAuthorizationDetails`
- `summarizeCliGrant`
- `AuthUser` type

## Components

### `IdpLoginForm`

Renders a sign-in form for the browser session flow.

Props:

- `returnTo?: string`
- `loginHint?: string`

Events:

- `success`

```vue
<script setup lang="ts">
import { IdpLoginForm } from '@openape/vue-components'

function handleSuccess() {
  console.log('signed in')
}
</script>

<template>
  <IdpLoginForm login-hint="user@example.com" return-to="/grants" @success="handleSuccess" />
</template>
```

The component posts to `/api/auth/challenge` and `/api/session/login`, refreshes the current user via `useIdpAuth()`, and redirects to `returnTo` when provided.

### `IdpGrantApproval`

Renders a grant approval or denial screen for one grant request.

Props:

- `grantId: string`

Events:

- `done(result: { status: string, authzJwt?: string })`

```vue
<script setup lang="ts">
import { IdpGrantApproval } from '@openape/vue-components'

function handleDone(result: { status: string, authzJwt?: string }) {
  console.log(result.status, result.authzJwt)
}
</script>

<template>
  <IdpGrantApproval grant-id="grant_123" @done="handleDone" />
</template>
```

The component reads the grant from `/api/grants/:grantId`, requires a logged-in user, and submits approval or denial requests back to the same API.

### `IdpEnrollConfirm`

Renders an enrollment confirmation screen for a new agent.

Props:

- `agentId?: string`
- `agentEmail?: string`
- `agentName?: string`
- `agentKey?: string`

Events:

- `enrolled(result: { agentId: string })`

```vue
<script setup lang="ts">
import { IdpEnrollConfirm } from '@openape/vue-components'

function handleEnrolled(result: { agentId: string }) {
  console.log(result.agentId)
}
</script>

<template>
  <IdpEnrollConfirm
    agent-email="agent@example.com"
    agent-name="Docs Agent"
    agent-key="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBexamplekeymaterial"
    @enrolled="handleEnrolled"
  />
</template>
```

The component pre-fills `owner` and `approver` from the logged-in user, validates that `agentKey` starts with `ssh-ed25519 `, and posts the enrollment request to `/api/agent/enroll`.

## Composables

### `useIdpAuth`

Provides shared authentication state for the current browser session.

Returns:

- `user: Ref<AuthUser | null>`
- `loading: Ref<boolean>`
- `fetchUser(): Promise<void>`
- `logout(): Promise<void>`

```ts
import { onMounted } from 'vue'
import { useIdpAuth } from '@openape/vue-components'

const { user, loading, fetchUser, logout } = useIdpAuth()

onMounted(fetchUser)
```

`fetchUser()` reads `/api/me`. `logout()` posts to `/api/session/logout` and clears `user`.

### `useKeyLogin`

Provides browser-side Ed25519 key login helpers backed by Web Crypto.

Signature:

- `useKeyLogin(idpBaseUrl?: string)`

Returns:

- `loginWithKey(email: string, privateKeyPem: string): Promise<boolean>`
- `importPrivateKey(pem: string): Promise<CryptoKey>`
- `loading: Ref<boolean>`
- `error: Ref<string>`

```ts
import { useKeyLogin } from '@openape/vue-components'

const { loginWithKey, loading, error } = useKeyLogin()

await loginWithKey('user@example.com', privateKeyPem)
```

`importPrivateKey()` accepts PEM-encoded PKCS#8 private keys and OpenSSH Ed25519 private keys. `loginWithKey()` requests a challenge from `/api/auth/challenge`, signs it in the browser, and creates a session through `/api/session/login`.

## CLI grant helpers

### `getCliAuthorizationDetails`

Filters authorization details down to `openape_cli` entries.

```ts
import { getCliAuthorizationDetails } from '@openape/vue-components'

const cliDetails = getCliAuthorizationDetails(details)
```

### `formatCliResourceChain`

Formats one CLI authorization detail into a readable resource chain.

```ts
import { formatCliResourceChain } from '@openape/vue-components'

const label = formatCliResourceChain(cliDetail)
```

### `summarizeCliGrant`

Builds a short summary string for one or more CLI authorization details.

```ts
import { summarizeCliGrant } from '@openape/vue-components'

const summary = summarizeCliGrant(details)
```

### `formatWidenedPreview`

Returns the `permission` value from each CLI authorization detail.

```ts
import { formatWidenedPreview } from '@openape/vue-components'

const preview = formatWidenedPreview(cliDetails)
```
