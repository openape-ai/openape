import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { useRoute, useRouter } from '#imports'

/**
 * Default user-facing copy for the RFC 6749 §4.1.2.1 OAuth error
 * codes. SPs can override by passing `messages` to `useOpenApeOAuthError`,
 * partial overrides are merged with these defaults.
 */
export const DEFAULT_OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied:
    'Die Anmeldung wurde vom Identity Provider abgelehnt. Wahrscheinlich hat dein Domain-Admin diese Anwendung noch nicht freigegeben — frag deinen Admin oder versuche eine andere Email-Adresse.',
  consent_required:
    'Diese Anmeldung benötigt eine explizite Zustimmung. Bitte versuche es erneut und stimme im Login-Fenster zu.',
  login_required:
    'Anmeldung erforderlich. Bitte erneut versuchen.',
  invalid_request:
    'Anmeldung fehlgeschlagen (invalid_request). Bitte erneut versuchen oder Support kontaktieren.',
  invalid_scope:
    'Anmeldung fehlgeschlagen (invalid_scope). Bitte erneut versuchen oder Support kontaktieren.',
  unauthorized_client:
    'Anmeldung fehlgeschlagen (unauthorized_client). Bitte erneut versuchen oder Support kontaktieren.',
  unsupported_response_type:
    'Anmeldung fehlgeschlagen (unsupported_response_type). Bitte erneut versuchen oder Support kontaktieren.',
  server_error:
    'Der Identity Provider hat gerade einen Fehler. Bitte in ein paar Minuten erneut versuchen.',
  temporarily_unavailable:
    'Der Identity Provider ist gerade nicht verfügbar. Bitte in ein paar Minuten erneut versuchen.',
}

const FALLBACK_MESSAGE = (code: string) => `Anmeldung fehlgeschlagen: ${code}.`

export interface OAuthError {
  /** RFC 6749 error code, e.g. 'access_denied'. */
  code: string
  /** RFC 6749 error_description if the IdP supplied one. */
  description: string
  /** Friendly copy mapped from `code`, or the SP's override. */
  message: string
}

export interface UseOAuthErrorOptions {
  /**
   * Per-SP overrides for the friendly copy. Merged on top of
   * `DEFAULT_OAUTH_ERROR_MESSAGES`. Useful when an SP wants to add
   * its own product-specific guidance ("contact Plans-Support") or
   * translate to a different locale.
   */
  messages?: Record<string, string>
}

/**
 * Surface RFC 6749 §4.1.2.1 OAuth-error redirects on the SP's
 * landing page. The IdP redirects here with `?error=<code>` (and
 * optionally `error_description`, `state`) when an authorize
 * request is rejected. Without dedicated handling the user just
 * sees the regular login form with mysterious URL params.
 *
 * Returns:
 *   - reactive `error` (null when no error in URL)
 *   - `dismiss()` to strip the OAuth params from the URL so a
 *     refresh doesn't re-render the alert
 *
 * Pair with `<OpenApeOAuthErrorAlert />` for a default-styled
 * UAlert, or render the message yourself for custom UI.
 */
export function useOpenApeOAuthError(opts: UseOAuthErrorOptions = {}): {
  error: ComputedRef<OAuthError | null>
  dismiss: () => void
} {
  const route = useRoute()
  const router = useRouter()

  const messageMap = { ...DEFAULT_OAUTH_ERROR_MESSAGES, ...(opts.messages ?? {}) }

  const error = computed<OAuthError | null>(() => {
    const code = route.query.error
    if (typeof code !== 'string' || !code) return null
    const description = typeof route.query.error_description === 'string'
      ? route.query.error_description
      : ''
    return {
      code,
      description,
      message: messageMap[code] ?? FALLBACK_MESSAGE(code),
    }
  })

  function dismiss() {
    // Strip OAuth-callback params so a refresh doesn't re-show the
    // alert. Keep the rest of the query intact so deep-links and
    // unrelated params survive.
    const next = { ...route.query }
    delete next.error
    delete next.error_description
    delete next.state
    router.replace({ path: route.path, query: next })
  }

  return { error, dismiss }
}
