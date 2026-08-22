// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { computed } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GuideShell from '../app/components/docs/GuideShell.vue'
import { docsGuide } from '../app/docs.generated'

// GuideShell reads the active story off the route via `useRoute`/`computed` —
// Nuxt/Vue auto-imports that do not exist outside Nuxt's runtime. Stubbed the
// same way this monorepo's other component tests stub such globals (e.g.
// tests/cockpit-push-enable.test.ts in openape-troop).
let routeParams: Record<string, string> = {}
vi.stubGlobal('useRoute', () => ({ params: routeParams }))
vi.stubGlobal('computed', computed)

// Nuxt UI and NuxtLink are auto-imported in the app; here they are stubbed to
// plain elements so assertions read the text and href, not the design system.
const global = {
  stubs: {
    NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
    UButton: { template: '<button><slot /></button>' },
  },
}

function shell(slots: Record<string, string> = { default: '<p>Story content</p>' }) {
  return mount(GuideShell, { slots, global })
}

const firstStory = docsGuide.categories[0]!.stories[0]!

describe('guide shell — navigation', () => {
  beforeEach(() => {
    routeParams = {}
  })

  it('shows the app name in the header', () => {
    expect(shell().text()).toContain('OpenApe Testrun')
  })

  it('lists every category and story from the generated guide', () => {
    const text = shell().text()
    for (const category of docsGuide.categories) {
      expect(text).toContain(category.title)
      for (const story of category.stories)
        expect(text).toContain(story.title)
    }
  })

  it('links each story to its own /docs/<id> page', () => {
    const link = shell().findAll('a').find(a => a.text() === firstStory.title)
    expect(link?.attributes('href')).toBe(`/docs/${firstStory.id}`)
  })

  it('renders the slot content into the main area', () => {
    expect(shell({ default: '<p>Story content</p>' }).find('main p').text()).toBe('Story content')
  })
})

describe('guide shell — active state', () => {
  it('marks the overview link active when no story is open', () => {
    routeParams = {}
    const overview = shell().findAll('a').find(a => a.text() === 'Overview')!
    expect(overview.classes()).toContain('text-primary-400')
  })

  it('marks the matching story link active instead of overview', () => {
    routeParams = { story: firstStory.id }
    const wrapper = shell()
    const overview = wrapper.findAll('a').find(a => a.text() === 'Overview')!
    const active = wrapper.findAll('a').find(a => a.text() === firstStory.title)!

    expect(overview.classes()).not.toContain('text-primary-400')
    expect(active.classes()).toContain('border-primary-500')
  })
})
