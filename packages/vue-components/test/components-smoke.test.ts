import type { Component } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Smoke floor: every component in src/ must at least mount without throwing.
 * Components that cannot mount standalone go into SKIP with the concrete
 * error as reason — that list is the declared backlog, not a green lie.
 */
const SKIP: Record<string, string> = {}

/** Minimal required props per component; everything else mounts bare. */
const REQUIRED_PROPS: Record<string, Record<string, unknown>> = {
  IdpGrantApproval: { grantId: 'grant-1' },
}

const modules = import.meta.glob<{ default: Component }>('../src/**/*.vue', { eager: true })

function componentName(path: string) {
  return path.split('/').pop()!.replace(/\.vue$/, '')
}

describe('component smoke floor', () => {
  beforeEach(() => {
    // Components fetch (/api/me, /api/grants/...) on mount; keep the smoke
    // test offline with a benign unauthenticated response.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const paths = Object.keys(modules)

  it('discovers components via glob', () => {
    expect(paths.length).toBeGreaterThan(0)
  })

  for (const path of paths) {
    const name = componentName(path)
    const skipReason = SKIP[name]

    if (skipReason) {
      it.skip(`mounts ${name} — SKIPPED: ${skipReason}`, () => {})
      continue
    }

    it(`mounts ${name}`, () => {
      const wrapper = mount(modules[path]!.default, {
        props: REQUIRED_PROPS[name] ?? {},
      })
      expect(wrapper.exists()).toBe(true)
      wrapper.unmount()
    })
  }
})
