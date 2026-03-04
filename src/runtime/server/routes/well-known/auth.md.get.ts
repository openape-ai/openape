import { defineEventHandler, getRequestURL, setResponseHeader } from 'h3'
import { getSpConfig } from '../../utils/sp-config'

export default defineEventHandler((event) => {
  const { spId, spName, fallbackIdpUrl } = getSpConfig()
  const origin = getRequestURL(event).origin

  setResponseHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')

  return `# Authentication — ${spName}

## Protocol
DDISA v1 (DNS-Discoverable Identity & Service Authorization)

## Service Provider
- **SP ID:** \`${spId}\`
- **Origin:** \`${origin}\`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/login | Start login — send \`{"email": "you@example.com"}\` |
| GET | /api/callback | OAuth callback (automatic) |
| GET | /api/me | Get current session (returns 401 if not authenticated) |
| POST | /api/logout | End session |
| GET | /.well-known/sp-manifest.json | SP metadata |

## How to Authenticate

### Step 1 — Start Login
\`\`\`
POST ${origin}/api/login
Content-Type: application/json

{"email": "your-identity@example.com"}
\`\`\`
Response: \`{"redirectUrl": "https://idp.example.com/authorize?..."}\`

### Step 2 — Authenticate at IdP
Follow the \`redirectUrl\`. The IdP at your email domain (discovered via DNS \`_ddisa.{domain}\`) handles authentication.

- **Humans:** WebAuthn passkey prompt
- **Agents:** Present your Bearer token (obtained via IdP challenge-response)

If no DNS record exists for your domain, the fallback IdP \`${fallbackIdpUrl}\` is used.

### Step 3 — Session Established
After successful authentication, you are redirected to \`/api/callback\`. A session cookie is set. Use \`GET /api/me\` to verify your session.

## Identity Discovery
This SP discovers your IdP via DNS TXT record:
\`\`\`
_ddisa.{your-domain} TXT "v=ddisa1 idp=https://your-idp.example.com"
\`\`\`
No DNS record? The fallback IdP (${fallbackIdpUrl}) is used automatically.
`
})
