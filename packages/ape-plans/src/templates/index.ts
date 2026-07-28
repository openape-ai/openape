// Starter templates for plan bodies. Shared source of truth: the CLI
// (`ape-plans templates` / `new --template`) and the web editor's template
// dropdown both read this module. Bodies mix Markdown with the component classes
// the plans renderer allows (callout*/badge*/card/grid/meta/lead) — they double
// as living examples of what agents can author.

export interface PlanTemplate {
  name: string
  description: string
  body: string
}

const FEATURE = `# <!-- Feature title -->

<p class="lead">One sentence on what this delivers and for whom.</p>

## Goal

<!-- What does "done" look like? -->

## Approach

<!-- The plan of attack. -->

## Milestones

1. **M1 —** <!-- … -->
2. **M2 —** <!-- … -->

<div class="callout callout-info">
<strong>Acceptance</strong> — observable criteria with exact commands and
expected output.
</div>
`

const BUGFIX = `# Fix: <!-- short symptom -->

<span class="badge badge-danger">bug</span>

## Repro

<!-- Exact steps / input that triggers it. -->

## Root cause

<!-- Why it happens — the real cause, not the symptom. -->

## Fix

<!-- What changes and where. -->

<div class="callout callout-success">
<strong>Proof</strong> — the test that fails before and passes after.
</div>
`

const BLANK = `# <!-- Title -->

<!-- Start writing. Markdown and a small set of HTML components are supported:
     callouts, badges, cards, grid. Run \`ape-plans docs\` for the full list. -->
`

export const PLAN_TEMPLATES: PlanTemplate[] = [
  { name: 'blank', description: 'Empty scaffold — a title and a hint.', body: BLANK },
  { name: 'feature', description: 'Feature plan — goal, approach, milestones, acceptance.', body: FEATURE },
  { name: 'bugfix', description: 'Bugfix — repro, root cause, fix, proof.', body: BUGFIX },
]

export function getTemplate(name: string): PlanTemplate | undefined {
  return PLAN_TEMPLATES.find(t => t.name === name)
}
