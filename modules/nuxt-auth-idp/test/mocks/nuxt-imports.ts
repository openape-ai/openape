import { ref } from 'vue'

const user = ref<Record<string, unknown> | null>({ email: 'approver@example.com' })
const loading = ref(false)
const route = {
  query: {} as Record<string, string>,
}

let navigateImpl: (...args: unknown[]) => unknown | Promise<unknown> = async () => {}
let fetchUserImpl: () => unknown | Promise<unknown> = async () => {}

export function __resetNuxtImportsMocks() {
  user.value = { email: 'approver@example.com' }
  loading.value = false
  route.query = {}
  navigateImpl = async () => {}
  fetchUserImpl = async () => {}
}

export function __setUser(value: Record<string, unknown> | null) {
  user.value = value
}

export function __setAuthLoading(value: boolean) {
  loading.value = value
}

export function __setRouteQuery(value: Record<string, string>) {
  route.query = value
}

export function __setNavigateTo(fn: (...args: unknown[]) => unknown | Promise<unknown>) {
  navigateImpl = fn
}

export function __setFetchUser(fn: () => unknown | Promise<unknown>) {
  fetchUserImpl = fn
}

export function navigateTo(...args: unknown[]) {
  return navigateImpl(...args)
}

export function useIdpAuth() {
  return {
    user,
    loading,
    fetchUser: () => fetchUserImpl(),
  }
}

export function useRoute() {
  return route
}
