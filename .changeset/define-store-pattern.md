---
"@openape/nuxt-auth-idp": minor
---

feat: add defineXxxStore pattern for custom storage backends

All 11 stores (grants, challenges, users, agents, credentials, etc.) are now replaceable via Nitro plugins. Apps can register custom store implementations using `defineGrantStore()`, `defineUserStore()`, etc. The default Unstorage-based implementation remains — no changes needed for existing apps.
