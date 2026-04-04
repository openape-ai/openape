import { ref } from 'vue'

export interface AuthUser {
  email: string
  name: string
  isAdmin: boolean
}

const user = ref<AuthUser | null>(null)
const loading = ref(false)

export function useIdpAuth() {
  async function fetchUser() {
    loading.value = true
    try {
      const res = await fetch('/api/me', { credentials: 'include' })
      if (!res.ok) throw new Error('Not authenticated')
      user.value = await res.json()
    }
    catch {
      user.value = null
    }
    finally {
      loading.value = false
    }
  }

  async function logout() {
    await fetch('/api/session/logout', { method: 'POST', credentials: 'include' })
    user.value = null
  }

  return { user, loading, fetchUser, logout }
}
