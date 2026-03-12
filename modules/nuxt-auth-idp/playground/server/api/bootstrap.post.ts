export default defineEventHandler(async (event) => {
  const origin = getRequestURL(event).origin
  const mgmtHeaders = { Authorization: 'Bearer playground-token' }

  // Check if any users exist
  const users = await $fetch<unknown[]>(`${origin}/api/admin/users`, { headers: mgmtHeaders })

  if (users.length > 0) {
    throw createError({ statusCode: 409, statusMessage: 'Users already exist. Bootstrap not needed.' })
  }

  // Create a registration URL for the admin
  const result = await $fetch<{ registrationUrl: string }>(`${origin}/api/admin/registration-urls`, {
    method: 'POST',
    headers: mgmtHeaders,
    body: {
      email: 'admin@playground.local',
      name: 'Playground Admin',
      expiresInHours: 168,
    },
  })

  return { registrationUrl: result.registrationUrl }
})
