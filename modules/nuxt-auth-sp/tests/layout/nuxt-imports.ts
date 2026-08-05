// Stand-in for Nuxt's `#imports`, wired up by vitest.browser.config.ts.
// The component only needs a session it can read and a router it can call;
// the tests own both refs so they can mount the loading state and the form.
import { ref } from 'vue'

export const user = ref<unknown>(null)
export const loading = ref(false)

export function useOpenApeAuth() {
  return { user, loading, fetchUser: async () => {}, login: async () => {} }
}

export function useRoute() {
  return { query: {} as Record<string, string> }
}

// Pulled in through useOpenApeOAuthError, which the component imports for its
// error copy.
export function useRouter() {
  return { replace: () => {} }
}

export function navigateTo() {}
