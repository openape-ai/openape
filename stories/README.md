# Story-Kanon

User-Stories sind hier die **einzige Hand-Eingabe** für Produktarbeit; Akzeptanzkriterien,
Tests, Code, Architektur-Doku und User-Guides werden daraus abgeleitet. Konzept + Regeln:
Plan „Story-Kanon-Workflow" auf plans.openape.ai (01KTS4717QTACGFCWD3SFWP0W0).

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
