---
'@openape/nuxt-auth-idp': patch
---

Browser-Navigationen erhalten bei Fehlern (429, 401, 404, 5xx, …) eine schlanke deutsche HTML-Fehlerseite statt rohem `application/problem+json` — bei 429 mit sichtbarer Wartezeit, Countdown und „Erneut versuchen". API-Clients (JSON-Accept, XHR, cors-Fetches) bekommen unverändert RFC-7807-Antworten.
