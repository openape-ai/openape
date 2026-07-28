import { randomBytes } from 'node:crypto'
import { setResponseHeaders } from 'h3'

// Defense-in-depth for the v-html plan renderer (app/utils/markdown.ts is the
// primary XSS fix). On every rendered HTML page we mint a per-request nonce,
// stamp it onto Nuxt's inline bootstrap scripts (color-mode + __NUXT__ config),
// and pin script-src to 'self' + that nonce. An injected inline <script> — say
// one that ever slipped past the sanitizer — carries no nonce and the browser
// refuses to run it. object-src/base-uri/frame-ancestors close the plugin,
// <base> and clickjacking vectors.
function buildCsp(nonce: string): string {
  return [
    'default-src \'self\'',
    `script-src 'self' 'nonce-${nonce}'`,
    'style-src \'self\' \'unsafe-inline\'',
    'img-src \'self\' https: data:',
    'font-src \'self\' data:',
    'connect-src \'self\'',
    'object-src \'none\'',
    'base-uri \'none\'',
    'frame-ancestors \'none\'',
    'form-action \'self\'',
  ].join('; ')
}

function stampNonce(chunks: string[], nonce: string): string[] {
  // Add nonce only to inline scripts still missing one.
  return chunks.map(html =>
    html.replace(/<script(?![^>]*\snonce=)/g, `<script nonce="${nonce}"`),
  )
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', (html, { event }) => {
    const nonce = randomBytes(16).toString('base64')
    html.head = stampNonce(html.head, nonce)
    html.bodyPrepend = stampNonce(html.bodyPrepend, nonce)
    html.body = stampNonce(html.body, nonce)
    html.bodyAppend = stampNonce(html.bodyAppend, nonce)

    setResponseHeaders(event, {
      'Content-Security-Policy': buildCsp(nonce),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    })
  })
})
