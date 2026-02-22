import type { DDISAAssertionClaims } from '@ddisa/core'

export function useAuth() {
  const user = useState<DDISAAssertionClaims | null>('user', () => null)
  const loading = useState('authLoading', () => true)

  async function fetchUser() {
    try {
      user.value = await $fetch<DDISAAssertionClaims>('/api/me')
    } catch {
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
