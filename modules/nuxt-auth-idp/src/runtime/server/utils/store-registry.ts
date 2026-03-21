import type { H3Event } from 'h3'

export type StoreFactory<T> = (event: H3Event) => T

const registry = new Map<string, StoreFactory<unknown>>()

export function registerStoreFactory<T>(name: string, factory: StoreFactory<T>) {
  registry.set(name, factory as StoreFactory<unknown>)
}

export function getStoreFactory<T>(name: string): StoreFactory<T> | undefined {
  return registry.get(name) as StoreFactory<T> | undefined
}
