// Stub Nitro/h3 auto-imported globals so server modules can be imported
// into the plain-node vitest environment without Nuxt's module system.
import { defineEventHandler } from 'h3'

const g = globalThis as Record<string, unknown>
g.defineEventHandler = defineEventHandler
