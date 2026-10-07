// Generated from schemas/report.schema.json by scripts/report-contract-types.mjs.

export interface Link {
  title: string
  url: string
  version?: number
  digest?: string
}

export interface Section {
  id: string
  title: string
  body: string
  placement?: 'before-details' | 'after-details'
}

export interface Target {
  id: string
  label: string
  kind: 'source' | 'build' | 'deployment' | 'device' | 'prototype' | 'other'
  commit?: string
  dirty?: boolean
  changesDigest?: string
  artifactDigest?: string
  version?: string
  environment?: string
  url?: string
  notes?: string
}

export interface Inspection {
  by: string
  at: string
  result: 'matches' | 'differs' | 'inconclusive'
  notes: string
  digest: string
}

export interface Image {
  id: string
  title: string
  kind: 'image'
  role: 'evidence' | 'reference' | 'mockup'
  path: string
  caption: string
  targetId?: string
  capturedAt?: string
  viewport?: {
    width: number
    height: number
  }
  theme?: 'light' | 'dark' | 'other'
  inspection?: Inspection
}

export interface TextEvidence {
  id: string
  title: string
  kind: 'text'
  role: 'evidence' | 'reference'
  path?: string
  text?: string
  language?: string
  targetId?: string
}

export interface LinkEvidence {
  id: string
  title: string
  kind: 'link'
  role: 'evidence' | 'reference' | 'mockup'
  url: string
  version?: number
  digest?: string
  targetId?: string
}

export type Evidence = Image | TextEvidence | LinkEvidence

export interface Command {
  id: string
  command: string
  targetId?: string
  cwd?: string
  outcome: 'exited' | 'timed-out' | 'interrupted' | 'not-started'
  exitCode?: number
  durationMs?: number
  startedAt?: string
  finishedAt?: string
  expectedExitCodes?: number[]
  summary?: string
  evidenceIds?: string[]
}

export interface Step {
  title: string
  status?: 'passed' | 'failed' | 'skipped' | 'blocked'
  caption?: string
  evidenceIds?: string[]
  commandIds?: string[]
}

export interface Check {
  id: string
  title: string
  status: 'passed' | 'failed' | 'skipped' | 'blocked'
  description?: string
  expected?: string
  observed?: string
  reason?: string
  error?: string
  targetId?: string
  commandIds?: string[]
  evidenceIds?: string[]
  steps?: Step[]
}

export interface Assessment {
  outcome: 'acceptable' | 'action-required' | 'inconclusive' | 'not-assessed'
  summary: string
  evidenceIds?: string[]
}

export interface Provenance {
  url: string
  version?: number
  digest?: string
  format: string
  notes?: string[]
}

export interface TestRun {
  title: string
  project?: string
  language?: string
  sample?: boolean
  targets?: Target[]
  evidence?: Evidence[]
  links?: Link[]
  sections?: Section[]
  provenance?: Provenance[]
  schema: 'openape.test-run/1'
  purpose: 'verification' | 'characterization' | 'reference'
  summary?: string
  series?: string
  startedAt?: string
  finishedAt?: string
  scope?: {
    covered?: string[]
    excluded?: string[]
  }
  commands?: Command[]
  tests: Check[]
  limitations?: string[]
  nextStep?: string
  assessment?: Assessment
}

export interface Decision {
  title: string
  description: string
  status: 'proposed' | 'accepted' | 'rejected'
  by?: string
  date?: string
  reference?: string
}

export interface Milestone {
  id: string
  title: string
  goal: string
  status: 'planned' | 'active' | 'done' | 'blocked'
  steps?: string[]
  acceptance: string[]
  proof?: string
  evidenceIds?: string[]
  rollback?: string
  blocker?: string
}

export interface ApprovalTarget {
  revision?: number
  sourceDigest?: string
  url?: string
  version?: number
}

export interface Approval {
  by: string
  date: string
  reference: string
  scope?: string
  target?: ApprovalTarget
}

export interface Completion {
  result: 'achieved' | 'partial' | 'not-achieved' | 'not-assessed'
  summary: string
  evidenceIds?: string[]
}

export interface Plan {
  title: string
  project?: string
  language?: string
  sample?: boolean
  targets?: Target[]
  evidence?: Evidence[]
  links?: Link[]
  sections?: Section[]
  provenance?: Provenance[]
  schema: 'openape.plan/2'
  goal: string
  status: 'draft' | 'active' | 'done' | 'archived'
  owner?: string
  date?: string
  revision?: number
  context?: string
  decisions?: Decision[]
  milestones: Milestone[]
  scope?: string[]
  nonGoals?: string[]
  risks?: {
    title: string
    mitigation: string
  }[]
  verification?: string[]
  changelog?: {
    date: string
    text: string
  }[]
  approval?: Approval
  completion?: Completion
  handoff?: string
  summary?: string
  problem?: ProblemOverview
  translations?: PlanTranslations
}

export interface ProblemOverview {
  statement: string
  impact: string
  approach: string
  outcome: string
}

export interface PlanTranslation {
  path: string
  source: string
  text: string
}

export interface PlanTranslations {
  defaultLanguage?: 'de' | 'en'
  entries: PlanTranslation[]
}

export type ReportDocument = TestRun | Plan
