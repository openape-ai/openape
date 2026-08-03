# Story-Kanon (eingefroren)

> **Status: eingefrorenes Experiment.** Letzte Änderung an `stories/` und den Story-Agents
> in `.claude/agents/` war der 2026-06-12; seither ist keine Zeile Produktarbeit über diesen
> Weg gelaufen. Der Ordner bleibt als Referenz stehen — er beschreibt nicht, wie heute
> gearbeitet wird.
>
> **Der tatsächliche Weg:** Arbeit startet als Issue auf git.openape.ai und landet per PR
> (`CONTRIBUTING.md`); alles, was länger als eine Session dauert, wird vorher als Plan in
> `.claude/plans/` geschrieben (gespiegelt auf plans.openape.ai) und während der Arbeit
> aktuell gehalten.
>
> Lebendig geblieben ist nur ein Teil davon: die User-Guides auf docs.openape.ai entstehen
> weiterhin aus den E2E-Captures (`compose/demo/`, `compose/distribute-docs.mjs`).

Das Konzept, das dieser Ordner beschreibt: User-Stories als einzige Hand-Eingabe für
Produktarbeit, aus der Akzeptanzkriterien, Tests, Code, Architektur-Doku und User-Guides
abgeleitet werden. Konzept + Regeln: Plan „Story-Kanon-Workflow" auf plans.openape.ai
(01KTS4717QTACGFCWD3SFWP0W0).

## Lebenszyklus einer Story

```
draft → consistent → approved → red → green → documented
```

| Übergang | Wer | Bedeutung |
|---|---|---|
| draft → consistent | Agent `story-consistency` | Kein Widerspruch zu VISION.md + bestehenden Stories; VISION.md um die neue Fähigkeit ergänzt |
| consistent → approved | **Mensch (einziger harter Gate)** | Akzeptanzkriterien (EARS-Form, vom Agent `story-spec` abgeleitet) sind gereviewt und freigegeben |
| approved → red | Agent `story-test` | Echte Tests existieren, mit Story-ID annotiert, und **failen** |
| red → green | Agent `story-implement` | Tests grün, PR nach CONTRIBUTING.md |
| green → documented | Mensch via Guide-Review | Guide regeneriert (`node compose/demo/run-stories.mjs && node compose/distribute-docs.mjs`); der Guide — nicht der Code — ist die Akzeptanz-Oberfläche |

## Datei-Format

Eine Datei pro Story. Frontmatter:

```yaml
id: recovery-adaptive-cooldown   # kebab-case, stabil
status: draft                    # s. Lebenszyklus
app: openape-free-idp            # besitzende App
issue: 462                       # GitHub-Issue (Pflicht, Issue-First-Workflow gilt weiter)
tests: []                        # Tracing: Test-Dateien/Story-Kit-Stories, die diese Story-ID tragen
guide: account-recovery          # Story-Kit-Story-ID des zugehörigen Guide-Kapitels (oder null)
```

Body: User-Story („Als … möchte ich …, damit …"), danach `## Akzeptanzkriterien`
(ab Status `consistent`). Ändert sich eine approvte Story substanziell, geht sie
zurück auf `draft`; die in `tests`/`guide` verlinkten Artefakte sind ab dann suspekt
(Blast-Radius).
