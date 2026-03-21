import { createDrizzleGrantStore } from '../utils/drizzle-grant-store'
import { createDrizzleGrantChallengeStore } from '../utils/drizzle-grant-challenge-store'

export default defineNitroPlugin(() => {
  if (process.env.OPENAPE_E2E === '1') return

  defineGrantStore(() => createDrizzleGrantStore())
  defineGrantChallengeStore(() => createDrizzleGrantChallengeStore())
})
