// OpenApe ID — account-recovery guide stories (issue #462). The captions
// become the end-user guide at id.openape.ai/docs; write them for people,
// not developers.
//
// story: recovery-broadcast          → guide id `account-recovery`
// story: recovery-adaptive-cooldown  → guide id `recovery-vacation-mode`
// story: recovery-audit              → guide id `recovery-history`
//
// Runs after the idp.mjs stories: the demo user exists and is signed in,
// exactly like a real owner who gets warned about a recovery attempt.
import { click, fillEmail } from '../story-kit.mjs'

export default async function run({ kit, page, EMAIL, IDP }) {
  // story: recovery-broadcast
  await kit.story({
    app: 'openape-free-idp',
    category: 'Account security',
    id: 'account-recovery',
    title: 'Recover your account — or stop an attack in one tap',
    intro: 'Lost every device with a passkey? Account recovery lets you enrol a new one after a waiting period — and because every recovery attempt is announced loudly on all your channels, an attacker can never run one quietly. This is the whole flow, from both sides.',
  }, async (s) => {
    await s.step('Start a recovery', {
      do: async () => {
        await page.goto(`${IDP}/login`, { waitUntil: 'networkidle' })
        await click(page, /lost access|recover account|can.?t sign in/i)
        await page.waitForTimeout(800)
      },
      shot: 'start-recovery',
    }, 'On the sign-in page choose **Lost access?** — no password reset, no support ticket. Recovery only ever grants permission to register a new passkey; it never signs anyone in by itself.')

    await s.step('Request it for your email', {
      do: async () => {
        await fillEmail(page, EMAIL)
        await click(page, /request|recover|continue|weiter/i)
        await page.waitForTimeout(1200)
      },
      shot: 'requested',
    }, 'Enter your account email. OpenApe ID answers the same way whether the address has an account or not, so nobody can use this form to probe for accounts. If it is yours, the waiting period starts now.')

    await s.step('Every channel gets the warning', {
      shot: 'warning-sent',
    }, 'The warning goes out immediately: a push notification to every device you enabled notifications on, and a mail to every address that was ever linked to your account — even ones you replaced years ago. A single compromised mailbox cannot swallow the alarm. Each warning names the exact moment the recovery could complete and carries a one-tap **Cancel recovery** link that works without signing in.')

    await s.step('Cancel it in one tap', {
      do: async () => {
        await page.goto(IDP, { waitUntil: 'networkidle' })
        await click(page, /wiederherstellungsschutz/i)
        await page.waitForURL(/\/recovery-protection/, { timeout: 10000 }).catch(() => {})
        await page.waitForTimeout(800)
        await click(page, /cancel recovery/i)
        await page.waitForTimeout(1000)
      },
      shot: 'cancelled',
    }, 'Didn\'t request it? Tap **Cancel recovery** in any warning — or on your **Recovery protection** page, one click from the dashboard — and the attempt is dead for good. A cancelled recovery can never be completed, not even after its waiting period would have ended. Signing in with one of your existing passkeys cancels it automatically, too.')
  })

  // story: recovery-adaptive-cooldown
  await kit.story({
    app: 'openape-free-idp',
    category: 'Account security',
    id: 'recovery-vacation-mode',
    title: 'Vacation mode: a longer shield while you are away',
    intro: 'The recovery waiting period adapts to how you use your account: 7 days while you are active, 72 hours once an account has been dormant for a month. Going off-grid? Vacation mode stretches the shield to up to 14 days so nobody can take over your account while you cannot react.',
  }, async (s) => {
    await s.step('Open Recovery protection', {
      do: async () => {
        await page.goto(IDP, { waitUntil: 'networkidle' })
        await click(page, /wiederherstellungsschutz/i)
        await page.waitForURL(/\/recovery-protection/, { timeout: 10000 }).catch(() => {})
        await page.waitForTimeout(800)
      },
      shot: 'settings',
    }, 'Open **Recovery protection** from your dashboard. Vacation mode lives here, in your account settings — only you, signed in, can change it. There is no way to flip it from the outside.')

    await s.step('Switch on vacation mode', {
      do: async () => {
        await page.getByRole('switch', { name: /vacation mode/i }).click()
        await page.waitForTimeout(800)
      },
      shot: 'vacation-on',
    }, 'Switch it on and pick how long a recovery attempt has to wait — up to 14 days, which is also the hard maximum. While it is on, the vacation wait applies no matter how recently you signed in.')

    await s.step('Your shield is set', {
      shot: 'vacation-set',
    }, 'That\'s it. A recovery requested from now on is bound to the wait that applied at the moment of the request — switching vacation mode off later never shortens a deadline that is already running.')
  })

  // story: recovery-audit
  await kit.story({
    app: 'openape-free-idp',
    category: 'Account security',
    id: 'recovery-history',
    title: 'See every recovery attempt — nothing disappears',
    intro: 'Every recovery attempt against your account is on permanent record: when it happened, where it came from, and how it ended. Attackers cannot probe quietly, and nobody — not even you — can scrub the record.',
  }, async (s) => {
    await s.step('Open Recovery protection', {
      do: async () => {
        await page.goto(IDP, { waitUntil: 'networkidle' })
        await click(page, /wiederherstellungsschutz/i)
        await page.waitForURL(/\/recovery-protection/, { timeout: 10000 }).catch(() => {})
        await page.waitForTimeout(800)
      },
      shot: 'settings',
    }, 'The recovery history sits on your **Recovery protection** page, right under vacation mode — visible only to you while signed in.')

    await s.step('Review every attempt', {
      do: async () => {
        await page.locator('#recovery-history').scrollIntoViewIfNeeded()
        await page.waitForTimeout(400)
      },
      shot: 'history',
    }, 'Each entry shows when the attempt was made, where it came from (IP address and browser, as far as known) and what became of it: still running — including the moment it could complete — finished, cancelled, or expired unused. Entries contain no links or codes an attacker could reuse, and they can neither be edited nor deleted: the cancelled attempt from the previous chapter stays on record forever.')
  })
}
