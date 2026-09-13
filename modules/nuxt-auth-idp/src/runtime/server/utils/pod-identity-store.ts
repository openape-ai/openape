import type { H3Event } from 'h3'
import { getStoreFactory, registerStoreFactory } from './store-registry'
import { createProblemError } from './problem'

export interface PodIdentityInput {
  email: string
  owner: string
  name: string
  keyId: string
  publicKey: string
}
export interface PodIdentityStore {
  provision: (input: PodIdentityInput) => Promise<void>
}
export function definePodIdentityStore(factory: (event: H3Event) => PodIdentityStore): void {
  registerStoreFactory('podIdentityStore', factory)
}
export function usePodIdentityStore(event: H3Event): PodIdentityStore {
  const factory = getStoreFactory<PodIdentityStore>('podIdentityStore')
  if (!factory) throw createProblemError({ status: 503, title: 'Atomic pod provisioning is not configured on this identity provider' })
  return factory(event)
}
