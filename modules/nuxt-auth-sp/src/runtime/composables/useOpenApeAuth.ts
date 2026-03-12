import { useState, navigateTo } from '#imports'
import type { DDISAAssertionClaims } from '@openape/core'

export function useOpenApeAuth() {
  const user = useState<DDISAAssertionClaims | null>('openape-user', () => null)
  const loading = useState('openape-auth-loading', () => true)

  async function fetchUser() {
    try {
      user.value = await $fetch<DDISAAssertionClaims>('/api/me')
    }
    catch {
      user.value = null
    }
    loading.value = false
  }

  async function login(email: string) {
    const { redirectUrl } = await $fetch<{ redirectUrl: string }>('/api/login', {
      method: 'POST',
      body: { email },
    })
    navigateTo(redirectUrl, { external: true })
  }

  async function logout() {
    await $fetch('/api/logout', { method: 'POST' })
    user.value = null
    navigateTo('/')
  }

  return { user, loading, fetchUser, login, logout }
}
