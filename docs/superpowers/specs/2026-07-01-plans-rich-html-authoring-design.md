# plans.openape.ai — Reiches HTML-Authoring (M3)

**Status:** Design approved · **Datum:** 2026-07-01
**Plan:** `01KWEBZQTR2B33A81T2MMC7XRT` (M3)
**Voraussetzung:** M1 (Sanitization) + M2 (CSP-Nonce) — PR #908, ausgeliefert.

## Ziel

Pläne auf plans.openape.ai sollen reich und schön formatiert sein. Autoren sind
Menschen **und** Agents. Agents sollen reiches HTML schreiben können, und das
Interface (CLI + Web) muss das einfach machen — inklusive fertiger Templates als
Starthilfe. Sicherheit ist nicht verhandelbar: jeder gerenderte Body bleibt
inert (siehe M1).

## Grundprinzip

`body_md` bleibt **ein** Feld und akzeptiert Markdown und HTML gemischt. `marked`
reicht Block-HTML durch, der Sanitizer (M1) macht es sicher. Kein neues
Storage-Feld, kein `content_type`-Flag, kein Server-Schema-Change. „Schön"
entsteht aus zwei Quellen:

1. Besseres Prose-CSS für Standard-Tags.
2. Ein kleines, **klassen-basiertes Komponenten-Set** (Callouts, Badges, Cards),
   das Templates verwenden und das der Sanitizer über eine feste
   Klassen-Allowlist durchlässt.

## Komponenten

### 1. Rendering — Allowlist erweitern (`apps/openape-plans/app/utils/markdown.ts`)

- Zusätzlich erlaubte Tags: `div`, `span`, `section`.
- `class` erlaubt auf `div`, `span`, `section`, `p`, `blockquote`, `a`, `code` —
  aber nur Werte aus einer **festen Klassen-Allowlist** via `sanitize-html`
  `allowedClasses`:
  - `callout`, `callout-info`, `callout-warn`, `callout-success`, `callout-danger`
  - `badge`, `badge-info`, `badge-warn`, `badge-success`, `badge-danger`, `badge-neutral`
  - `card`, `grid`, `meta`, `lead`
- Alle anderen Klassen werden entfernt (kein beliebiges Class-Injection). Alles
  aus M1 (Scripts, `on*`, `javascript:`/`data:`, iframe/object/style/form) bleibt
  hart verboten.
- **Grenze:** Der Sanitizer ist die einzige Vertrauensgrenze. Die Klassen-
  Allowlist ist Teil davon.

### 2. Komponenten-CSS (`apps/openape-plans/app/assets/main.css`)

Ein schlanker Styling-Layer, gescoped auf den `.prose`-Container der Plan-Seite:

- **Callouts:** farbige Box mit linkem Akzent-Rand, je Variante (info/warn/
  success/danger) eigene Farbe. Dark-Mode-fähig.
- **Badges:** kleine Status-Pills, je Variante gefärbt.
- **Card / Grid:** einfache Karten-Box; `grid` = responsives 2-Spalten-Layout.
- **Meta / Lead:** gedämpfte Meta-Zeile bzw. hervorgehobener Intro-Absatz.
- Allgemein aufgehübschte Prose-Defaults: Tabellen (Rahmen, Zebra), code-Blöcke,
  Überschriften-Abstände, Blockquote.

### 3. Templates in der CLI (`packages/ape-plans`)

- Template-Dateien versioniert im Package: `src/templates/{blank,feature,bugfix}.html`.
  Start-Set schlank (YAGNI, wächst bei Bedarf):
  - `blank` — leeres Gerüst (Titel-Überschrift + leere Sektionen).
  - `feature` — Ziel / Ansatz / Milestones / Akzeptanzkriterien.
  - `bugfix` — Repro / Ursache / Fix / Proof.
  - Jedes Template nutzt die Komponenten-Klassen (z.B. Callout für „Akzeptanz",
    Badges für Status) als lebendes Beispiel für Agents.
- `ape-plans templates` — listet Name + Kurzbeschreibung (`--json`-fähig wie die
  übrigen Commands).
- `ape-plans new --template <name>` — befüllt den Body mit dem Template:
  - TTY: Template wird in `$EDITOR` vorbefüllt (statt des bisherigen
    `# ${title}`-Stubs).
  - Non-TTY / `--id-only`: Template wird direkt als Body gesendet.
  - Kombinierbar mit `--title`, `--team`, `--status`.
  - Präzedenz: `--body-from-file`/`--body-from-stdin` schlagen `--template`
    (explizit gelieferter Body gewinnt); Fehler wenn beide widersprüchlich
    gesetzt sind.
- `ape-plans docs` bekommt einen Abschnitt **„Rich HTML authoring"**: erklärt,
  dass Body HTML+Markdown akzeptiert, listet die erlaubten Komponenten-Klassen
  mit Mini-Beispiel und die verfügbaren Templates. Das ist die eine Quelle der
  Wahrheit für Agents.

### 4. Web-Editor (`apps/openape-plans/app/pages/teams/[id]/plans/[planId]/edit.vue`)

- Bleibt Source+Preview (write/preview-Tabs). Preview nutzt schon
  `renderMarkdown` → zeigt sanitized + gestylt.
- Ergänzt um einen **„Template einfügen"-Dropdown**: fügt den Template-Quelltext
  in den Body-Textarea ein (an Cursor/Ende). Templates kommen aus einer geteilten
  Quelle (siehe Datenfluss).

## Datenfluss Templates (eine Quelle)

Templates leben als Dateien im `ape-plans`-Package. Der Web-Editor braucht
dieselben Templates. Statt sie zu duplizieren:

- Die Template-Inhalte werden als **side-effect-freies** Datenmodul im
  `ape-plans`-Package exportiert und über einen dedizierten Subpath verfügbar
  gemacht: `@openape/ape-plans/templates` (`src/templates/index.ts`:
  `{ name, description, body }[]`, das die `.html`-Dateien zur Buildzeit inlined;
  kein CLI-Runtime-Import, keine Seiteneffekte).
- CLI konsumiert dieses Modul direkt.
- Web-Editor: die plans-App nimmt `@openape/ape-plans` als `workspace:*`-Dep und
  ein kleiner **`GET /api/templates`**-Endpoint im App-Server re-exportiert die
  Liste aus `@openape/ape-plans/templates`. Eine Quelle, keine Duplizierung.

## Sicherheit / Invarianten

- Gerenderter Body ist immer inert (M1-Tests gelten weiter).
- Neue Tests: Body mit Fremd-Klasse (`class="evil"`) → Klasse entfernt; Body mit
  erlaubter Klasse (`class="callout-warn"`) → Klasse bleibt; Komponenten-Tags
  ohne Klasse rendern neutral.
- CSP (M2) bleibt aktiv und unverändert; div/span/section führen keine neuen
  Script-Vektoren ein.

## Proof (Akzeptanz)

1. `packages/ape-plans` Test: `templates` listet ≥3 Einträge; `new --template
   feature` erzeugt einen Body, der die Feature-Sektionen enthält.
2. `apps/openape-plans` Sanitizer-Tests: Klassen-Allowlist (fremde Klasse raus,
   erlaubte bleibt), Komponenten-Tags erlaubt, M1-Payloads weiter inert.
3. Vorher/Nachher-Screenshot: ein Template-Plan rendert mit Callouts + Badges,
   Dark-Mode, Prose-Styling.
4. `pnpm lint` + `pnpm typecheck` + `pnpm test` grün.

## Bewusst weggelassen (YAGNI)

- **Kein WYSIWYG-Editor** (tiptap o.ä.). Agents schreiben HTML/MD-Quelle; Menschen
  via Source+Preview + Template-Dropdown. Deckt „einfach HTML schreiben" ohne
  schwere Editor-Dependency; Agent- und Menschen-Pfad schreiben denselben
  Quelltext.
- **Kein Server-Template-Storage.** Templates sind statische Dateien im
  CLI-Package, versioniert.
- **Kein `content_type`-Feld / Format-Migration.** Ein Body-Feld, MD+HTML gemischt.
- Nur 3 Start-Templates; weitere bei realem Bedarf.
