// Vacation policy for the adaptive recovery cooldown (#462).
//
// Single source of truth for the 14-day vacation cap/default: the request
// endpoint clamps with it, the settings endpoints validate and default with
// it, and the account UI mirrors it. Shared so the security-relevant cap
// can never drift between server and UI.
export const VACATION_MAX_DAYS = 14
export const VACATION_DEFAULT_DAYS = 14
