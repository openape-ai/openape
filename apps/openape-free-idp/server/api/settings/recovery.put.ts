import { createError, defineEventHandler, readBody } from 'h3'
import { VACATION_MAX_DAYS } from '#shared/recovery-policy'

// Vacation switch for the adaptive recovery cooldown (#462).
//
// Owner-only: the target account is ALWAYS the authenticated caller —
// any body-supplied email is ignored, so nobody can stretch or shrink
// another account's recovery window. The vacation wait is hard-capped
// at 14 days; longer values are rejected, not clamped, so the owner
// knows exactly what protection is in force.

export default defineEventHandler(async (event) => {
  // requireAuth + useIdpStores are auto-imported module utils.
  const email = await requireAuth(event)

  const body = await readBody<{ vacationMode?: unknown, vacationDays?: unknown }>(event)
  const vacationMode = body?.vacationMode
  if (typeof vacationMode !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'vacationMode must be a boolean' })
  }

  const updates: { recoveryVacationMode: boolean, recoveryVacationDays?: number } = {
    recoveryVacationMode: vacationMode,
  }

  if (body.vacationDays !== undefined) {
    const days = body.vacationDays
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > VACATION_MAX_DAYS) {
      throw createError({
        statusCode: 400,
        statusMessage: `vacationDays must be an integer between 1 and ${VACATION_MAX_DAYS}`,
      })
    }
    updates.recoveryVacationDays = days
  }

  const { userStore } = useIdpStores()
  await userStore.update(email, updates)

  return { ok: true, vacationMode, vacationDays: updates.recoveryVacationDays }
})
