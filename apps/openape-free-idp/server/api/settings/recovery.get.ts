import { createError, defineEventHandler } from 'h3'
import { VACATION_DEFAULT_DAYS } from '#shared/recovery-policy'

// Current vacation settings for the signed-in owner (#462) — the read
// counterpart of recovery.put.ts so the account UI shows what is in force.
// Owner-only, returns no secrets.

export default defineEventHandler(async (event) => {
  // requireAuth + useIdpStores are auto-imported module utils.
  const email = await requireAuth(event)

  const { userStore } = useIdpStores()
  const user = await userStore.findByEmail(email)
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown user' })
  }

  return {
    vacationMode: user.recoveryVacationMode ?? false,
    vacationDays: user.recoveryVacationDays ?? VACATION_DEFAULT_DAYS,
  }
})
