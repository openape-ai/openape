---
"openape-free-idp": minor
---

free-idp: per-bucket YOLO UI on the agent detail page

Replaces the single "YOLO-Modus" section on `/agents/:email` with four
audience-bucket cards: **Commands** (ape-shell, claude-code, shapes),
**Web** (ape-proxy), **Root-Commands** (escapes), and **Default**
(wildcard fallback). Each card owns its own load / save / delete
lifecycle through the audience-aware YOLO endpoints introduced in the
foundation PR.

User-visible result: an operator can YOLO `ape-proxy` (auto-approve
network egress) without YOLOing `ape-shell` (still confirm every bash
line) — and vice versa. Deny-patterns are configured per bucket so a
network-egress deny-list doesn't accidentally block bash commands.

Aggregate state per bucket:

- **all** — every audience in the bucket has a YOLO row → "YOLO aktiv" badge
- **partial** — some audiences in the bucket have YOLO, some don't →
  "YOLO teilweise" badge with a hint that saving will unify them
- **none** — bucket inactive, requests in this layer wait for human
  confirmation

For multi-audience buckets (Commands has three) Enable writes one
yolo_policies row per audience; Disable deletes them all. Single-
audience buckets (Web, Root, Default) are 1:1.

Adds a client-side mirror of the audience-bucket registry under
`app/utils/audience-buckets.ts`. Kept in sync with the server-side
registry by hand for now (small, stable map). Documented inline.
