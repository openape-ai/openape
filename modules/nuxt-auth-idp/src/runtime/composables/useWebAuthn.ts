import { ref } from 'vue'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'

export function useWebAuthn() {
  const error = ref('')
  const loading = ref(false)

  async function registerWithToken(token: string, deviceName?: string) {
    error.value = ''
    loading.value = true
    try {
      // Get registration options
      const { options, challengeToken } = await $fetch<{ options: any, challengeToken: string }>(
        '/api/webauthn/register/options',
        { method: 'POST', body: { token } },
      )

      // Start WebAuthn registration in the browser
      const response = await startRegistration({ optionsJSON: options })

      // Verify with server
      const result = await $fetch<{ ok: boolean, email: string, name: string }>(
        '/api/webauthn/register/verify',
        { method: 'POST', body: { token, challengeToken, response, deviceName } },
      )

      return result
    }
    catch (err: unknown) {
      const e = err as { data?: { statusMessage?: string }, message?: string }
      error.value = e.data?.statusMessage ?? e.message ?? 'Registration failed'
      throw err
    }
    finally {
      loading.value = false
    }
  }

  async function login(email?: string) {
    error.value = ''
    loading.value = true
    try {
      // Get authentication options
      const { options, challengeToken } = await $fetch<{ options: any, challengeToken: string }>(
        '/api/webauthn/login/options',
        { method: 'POST', body: { email } },
      )

      // Start WebAuthn authentication in the browser
      const response = await startAuthentication({ optionsJSON: options })

      // Verify with server
      const result = await $fetch<{ ok: boolean, email: string, name: string }>(
        '/api/webauthn/login/verify',
        { method: 'POST', body: { challengeToken, response } },
      )

      return result
    }
    catch (err: unknown) {
      const e = err as { data?: { statusMessage?: string }, message?: string }
      error.value = e.data?.statusMessage ?? e.message ?? 'Login failed'
      throw err
    }
    finally {
      loading.value = false
    }
  }

  async function addDevice(deviceName?: string) {
    error.value = ''
    loading.value = true
    try {
      // Get registration options for adding a device
      const { options, challengeToken } = await $fetch<{ options: any, challengeToken: string }>(
        '/api/webauthn/credentials/add/options',
        { method: 'POST' },
      )

      // Start WebAuthn registration in the browser
      const response = await startRegistration({ optionsJSON: options })

      // Verify with server
      const result = await $fetch<{ ok: boolean, credentialId: string }>(
        '/api/webauthn/credentials/add/verify',
        { method: 'POST', body: { challengeToken, response, deviceName } },
      )

      return result
    }
    catch (err: unknown) {
      const e = err as { data?: { statusMessage?: string }, message?: string }
      error.value = e.data?.statusMessage ?? e.message ?? 'Failed to add device'
      throw err
    }
    finally {
      loading.value = false
    }
  }

  return { error, loading, registerWithToken, login, addDevice }
}
