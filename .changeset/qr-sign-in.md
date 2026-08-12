---
'@openape/nuxt-auth-idp': minor
---

QR sign-in: a browser without a passkey (public computer, kiosk) shows a QR code on the login page; a signed-in phone scans it, reviews the requester and approves; the kiosk claims the session. Two-token design (channelId in the QR, claimSecret only at the kiosk), approve is human-cookie-only and unchainable, channels are single-use with a 120s TTL in their own rate-limit bucket, and transferred sessions are marked, capped at one hour and remotely revocable from the account page.
