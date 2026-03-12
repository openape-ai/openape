import { useState } from '#imports'

interface AuthUser {
  email: string
  name: string
  isAdmin: boolean
}

export function useIdpAuth() {
  const user = useState<AuthUser | null>('idp-auth-user', () => null)
  const loading = useState<boolean>('idp-auth-loading', () => false)

  async function fetchUser() {
    loading.value = true
    try {
      const data = await $fetch<AuthUser>('/api/me')
      user.value = data
    }
    catch {
      user.value = null
    }
    finally {
      loading.value = false
    }
  }

  async function logout() {
    await $fetch('/api/logout', { method: 'POST' })
    user.value = null
  }

  return { user, loading, fetchUser, logout }
}
