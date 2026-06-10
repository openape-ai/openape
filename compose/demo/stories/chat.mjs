// OpenApe Chat user stories.
import { approveIfPrompted, click, fillEmail } from '../story-kit.mjs'

export default async function run({ kit, page, EMAIL, CHAT }) {
  await kit.story({
    app: 'openape-chat',
    category: 'Getting started',
    id: 'one-click-sso',
    title: 'Sign in with one click',
    intro: 'Chat is a DDISA Service Provider. With an existing IdP session (say, from Troop) you are in with a single click — same passkey, same IdP, no second prompt.',
  }, async (s) => {
    await s.step('Open Chat', {
      do: () => page.goto(CHAT, { waitUntil: 'networkidle' }),
      shot: 'landing',
    }, 'Chat\'s start page — enter your email and continue.')

    await s.step('One click, signed in', {
      do: async () => {
        await fillEmail(page, EMAIL)
        await click(page, /sign in with openape|sign in|login|anmelden/i)
        await page.waitForTimeout(2500)
        await approveIfPrompted(page)
        await page.waitForURL(/chat\.openape\.test/, { timeout: 20000 }).catch(() => {})
        await page.waitForTimeout(2500)
      },
      shot: 'home',
    }, 'Because your IdP session already exists, the round-trip is instant: you land in the conversation home, ready to talk to people and agents. Tap the add-contact button or spawn an agent with `apes agents spawn <name>` to start a conversation.')
  })
}
