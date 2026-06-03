---
"@openape/core": patch
---

Fix OpenApeManifest.scopes type + validateOpenApeManifest to the array form ({ id, description, grants?, ... }[]) per protocol sp-scope-catalog.json and the cross-SP consumer. The previous Record shape caused validateOpenApeManifest (used by the IdP's fetchSpManifest) to reject the array-format manifests that SPs actually serve.
