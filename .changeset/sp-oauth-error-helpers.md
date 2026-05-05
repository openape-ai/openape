---
'@openape/nuxt-auth-sp': minor
---

Add `useOpenApeOAuthError()` composable + `<OpenApeOAuthErrorAlert />` component for surfacing IdP-side authorize-deny errors (RFC 6749 §4.1.2.1) on the SP's landing page. Without this, an SP redirected back with `?error=access_denied` left the user on the regular login form with no clue what happened. Drop the component on a login page and the user sees a friendly title + reason copy instead.

The composable exposes `{ error, dismiss }`; the component wraps it in a UAlert with sensible defaults. SPs can override the per-code copy via the `messages` prop / option for product-specific guidance.
