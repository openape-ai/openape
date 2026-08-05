import { computed, ref } from 'vue'

// A screenshot far wider than the phone — the shape that has to be reined in —
// and one small enough that the frame has to shrink to it.
export const WIDE_SHOT_WIDTH = 1200
export const SMALL_SHOT_WIDTH = 120

function svgShot(width: number, height: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#333"/></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

// One unbroken 400-character token: nothing for the browser to wrap on, so the
// code block either scrolls or drags the page sideways.
const LONG_LINE = 'x'.repeat(400)

export const RUN = {
  title: 'Proof link round-trip',
  project: 'testrun',
  status: 'passed',
  passed: 1,
  failed: 0,
  skipped: 0,
  summary_html: `<pre><code>${LONG_LINE}</code></pre><ul><li>uploaded</li></ul>`,
  started_at: 1_754_000_000,
  finished_at: 1_754_000_042,
  created_by: 'patrick@hofmann.eco',
  created_by_act: 'human',
  created_at: 1_754_000_000,
  version: 1,
  latest_version: 1,
  versions: [{ version: 1, status: 'passed', created_at: 1_754_000_000 }],
  tests: [{
    id: 't1',
    title: 'uploads a report',
    status: 'passed',
    description_html: '<p>Pushes a run and reads it back.</p>',
    error_html: '',
    steps: [
      { title: 'Desktop capture', status: 'passed', caption_html: '<p>The report as a reader sees it.</p>', shot: svgShot(WIDE_SHOT_WIDTH, 675) },
      { title: 'Ok', status: 'passed', caption_html: '', shot: svgShot(SMALL_SHOT_WIDTH, 80) },
    ],
  }],
}

// The page reaches for Nuxt's auto-imports, which resolve through the global
// scope at call time. Outside a Nuxt build nothing puts them there, so the
// tests do — a route, a resolved fetch and a no-op head.
export function installNuxtGlobals() {
  Object.assign(globalThis, {
    computed,
    useRoute: () => ({ params: { slug: 'demo' }, query: {}, path: '/r/demo' }),
    useFetch: async () => ({ data: ref(RUN), error: ref(null) }),
    useSeoMeta: () => {},
  })
}
