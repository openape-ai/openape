---
'@openape/nuxt-auth-idp': minor
---

Approval-Karte erklärt, warum ein Grant wartet: neue Diagnose-Hooks
(`defineApprovalDiagnosticHook`, Spiegelbild der Pre-Approval-Hooks) lassen
jeden Auto-Approve-Mechanismus seinen eigenen Fehlschlag begründen. Der
Grant-Detail-Endpoint hängt die Erklärungen als `pending_diagnostics` an.
