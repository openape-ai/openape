import type { Slots } from 'vue'
import { h } from 'vue'

interface RouteTarget { path: string, query?: Record<string, string> }

export const routeBoundary = {
  stubs: {
    NuxtLink: {
      props: ['to'],
      setup(props: { to: string | RouteTarget }, { slots }: { slots: Slots }) {
        return () => {
          const target = props.to
          const href = typeof target === 'string' ? target : `${target.path}${target.query ? `?${new URLSearchParams(target.query)}` : ''}`
          return h('a', { href }, slots.default?.())
        }
      },
    },
  },
}

export function screenshotPath(name: string) {
  return `../../.artifacts/ui-test-migration/${name}.png`
}
