// OpenApe ID (free-idp) user stories — guide content lives in the captions.
import { approveIfPrompted, click, fillEmail } from '../story-kit.mjs'

export default async function run({ kit, page, EMAIL, IDP, REG_TOKEN }) {
  await kit.story({
    app: 'openape-free-idp',
    category: 'Getting started',
    id: 'create-identity',
    title: 'Create your identity',
    intro: 'Register a WebAuthn passkey — no password, ever. Your OpenApe ID becomes the DDISA authority for your identity: every Service Provider logs you in via DNS-discovered SSO without ever seeing a credential.',
  }, async (s) => {
    await s.step('Open OpenApe ID', {
      do: () => page.goto(IDP, { waitUntil: 'networkidle' }),
      shot: 'landing',
    }, 'The landing page asks for nothing but your email. Click **Create account** to start.')

    await s.step('Request your registration link', {
      do: async () => {
        await click(page, /create account/i)
        await page.waitForTimeout(1000)
        await fillEmail(page, EMAIL, { optional: true })
      },
      shot: 'request-link',
    }, 'Enter your email — OpenApe ID sends you a one-time registration link.')

    await s.step('Register your passkey', {
      do: async () => {
        if (!REG_TOKEN)
          throw new Error('REG_TOKEN not set — run via compose/demo/run.sh')
        await page.goto(`${IDP}/register?token=${REG_TOKEN}`, { waitUntil: 'networkidle' })
      },
      shot: 'register-passkey',
    }, 'The link opens the passkey ceremony. Your device (Touch ID, Windows Hello, a security key) creates the credential — in this E2E run a virtual authenticator answers headlessly.')

    await s.step('Done — you are signed in', {
      do: async () => {
        await click(page, /create|register|passkey|continue|add|finish|sign up/i)
        await page.waitForTimeout(3500)
        await approveIfPrompted(page)
      },
      shot: 'registered',
    }, 'That\'s the whole sign-up: one passkey, no password to remember or leak.')
  })

  await kit.story({
    app: 'openape-free-idp',
    category: 'Account',
    id: 'account-dashboard',
    title: 'Your account — one page per thing',
    intro: 'The dashboard is home base for your identity. Every button opens a focused page that shows exactly what it names — passkeys, SSH keys, connected services, delegations — rather than one long settings dump.',
  }, async (s) => {
    await s.step('Your dashboard', {
      do: async () => {
        await page.goto(IDP, { waitUntil: 'networkidle' })
        await page.waitForTimeout(1200)
      },
      shot: 'dashboard',
    }, 'Signed in, the root page is your hub: **Passkeys**, **SSH-Keys**, **Agents**, **Berechtigungen**, **Delegationen** and **Verbundene Dienste** — each its own button leading to its own page.')

    await s.step('Passkeys — just your passkeys', {
      do: async () => {
        await click(page, /passkeys verwalten/i)
        await page.waitForURL(/\/passkeys/, { timeout: 10000 }).catch(() => {})
        await page.waitForTimeout(1000)
      },
      shot: 'passkeys',
    }, '**Passkeys verwalten** opens *only* your passkeys — add a device, remove an old one. Nothing else on the page.')

    await s.step('SSH keys — just your keys', {
      do: async () => {
        await page.goBack({ waitUntil: 'networkidle' }).catch(() => {})
        await page.waitForTimeout(600)
        await click(page, /ssh-keys verwalten/i)
        await page.waitForURL(/\/ssh-keys/, { timeout: 10000 }).catch(() => {})
        await page.waitForTimeout(1000)
      },
      shot: 'ssh-keys',
    }, '**SSH-Keys verwalten** is only your SSH public keys for *Sign in with SSH Key* — paste one, remove one.')

    await s.step('Connected services — just your consents', {
      do: async () => {
        await page.goBack({ waitUntil: 'networkidle' }).catch(() => {})
        await page.waitForTimeout(600)
        await click(page, /verbundene dienste/i)
        await page.waitForURL(/\/connected-services/, { timeout: 10000 }).catch(() => {})
        await page.waitForTimeout(1000)
      },
      shot: 'connected-services',
    }, '**Verbundene Dienste** lists the apps you approved at sign-in. Revoke one and it asks for consent again next time. (Your **Delegationen** — apps acting for you at *another* service — get their own page too.)')
  })
}
