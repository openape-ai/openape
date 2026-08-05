import type { Slots } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { h, Suspense } from 'vue'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { installNuxtGlobals, SMALL_SHOT_WIDTH, WIDE_SHOT_WIDTH } from './report-fixture'
import ReportPage from '../../app/pages/r/[slug].vue'

// A phone viewport (390px) is set in vitest.browser.config.ts. Nuxt UI is
// stubbed; the styles under test ship with the page itself.
//
// Stubs must be render functions, not `template` strings: the browser build of
// Vue ships without the compiler, so a string template renders NOTHING — and a
// report made of empty boxes passes every width assertion. `renders the report
// it is handed` guards exactly that.
const global = {
  stubs: {
    UIcon: { render: () => h('span', { class: 'stub-icon' }, '·') },
    UBadge: { setup: (_: unknown, { slots }: { slots: Slots }) => () => h('span', { class: 'stub-badge' }, slots.default?.()) },
    NuxtLink: { setup: (_: unknown, { slots }: { slots: Slots }) => () => h('a', { class: 'stub-link' }, slots.default?.()) },
  },
}

const box = (el: Element) => el.getBoundingClientRect()
const PAGE_WIDTH = 390

let wrapper: ReturnType<typeof mount>

// The page awaits its fetch, so its setup is async and Vue will only render it
// inside a Suspense boundary — in the app that boundary is Nuxt's page shell.
const PageInSuspense = { render: () => h(Suspense, null, { default: () => h(ReportPage) }) }

/** Mounts the page, waits out its fetch, and lets the screenshots decode. */
async function openReport() {
  wrapper = mount(PageInSuspense, { global, attachTo: document.body })
  await flushPromises()
  const images = [...document.querySelectorAll<HTMLImageElement>('.shot img')]
  await Promise.all(images.map(img => img.decode()))
  return images
}

function shots() {
  return document.querySelectorAll<HTMLElement>('.shot')
}

beforeAll(() => {
  installNuxtGlobals()
})

afterEach(() => {
  wrapper?.unmount()
})

describe('report page on a phone', () => {
  it('renders the report it is handed', async () => {
    const images = await openReport()

    // If any of these is empty the geometry below is measuring nothing.
    expect(shots()).toHaveLength(2)
    expect(images.map(img => img.naturalWidth)).toEqual([WIDE_SHOT_WIDTH, SMALL_SHOT_WIDTH])
    expect(document.querySelectorAll('.stub-icon').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.stub-badge')).toHaveLength(1)
    expect(document.querySelector('.prose-report pre')).not.toBeNull()
    expect(document.querySelector('.prose-report ul li')).not.toBeNull()
  })

  it('reins a desktop screenshot in to the width of the phone', async () => {
    const [wide] = await openReport()
    const frame = shots()[0]!

    // A 1200px capture, shown on a 390px screen: the picture scales down to
    // the frame rather than the frame growing to the picture.
    expect(frame.offsetWidth).toBeLessThanOrEqual(PAGE_WIDTH)
    expect(wide!.offsetWidth).toBeLessThanOrEqual(frame.clientWidth)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(PAGE_WIDTH)
  })

  it('shrinks the frame to a screenshot smaller than the column', async () => {
    const images = await openReport()
    const small = images[1]!
    const frame = shots()[1]!

    // The frame is a window around the image, not a band across the page: it
    // ends one border past the picture instead of running to the column edge.
    expect(small.offsetWidth).toBe(SMALL_SHOT_WIDTH)
    expect(frame.offsetWidth).toBe(small.offsetWidth + 2)
    expect(frame.offsetWidth).toBeLessThan(PAGE_WIDTH)
  })

  it('lays the three window dots out along the title bar', async () => {
    await openReport()
    const bar = shots()[0]!.querySelector('.shot-bar')!
    const dots = [...bar.querySelectorAll<HTMLElement>('.shot-dot')]
    const label = bar.querySelector('.shot-label')!

    expect(dots).toHaveLength(3)
    for (const dot of dots) {
      expect(box(dot).width).toBe(10)
      expect(box(dot).height).toBe(10)
    }
    // 12px in from the bar edge, then 6px between each pair.
    expect(box(dots[0]!).left - box(bar).left).toBe(12)
    expect(box(dots[1]!).left - box(dots[0]!).right).toBe(6)
    expect(box(dots[2]!).left - box(dots[1]!).right).toBe(6)
    expect(box(label).left - box(dots[2]!).right).toBe(14)
  })
})

describe('markdown blocks on a phone', () => {
  it('scrolls a long code line instead of dragging the page sideways', async () => {
    await openReport()
    const pre = document.querySelector<HTMLElement>('.prose-report pre')!

    expect(pre.scrollWidth).toBeGreaterThan(pre.clientWidth)
    expect(pre.offsetWidth).toBeLessThanOrEqual(PAGE_WIDTH)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(PAGE_WIDTH)
  })

  it('indents list items away from the text above them', async () => {
    await openReport()
    const list = document.querySelector<HTMLElement>('.prose-report ul')!
    const item = list.querySelector<HTMLElement>('li')!

    expect(box(item).left - box(list).left).toBe(20)
  })
})
