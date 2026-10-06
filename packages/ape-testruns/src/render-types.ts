export interface PlanDecision {
  title: string
  description: string
  status: 'proposed' | 'accepted' | 'rejected'
  by?: string
  date?: string
}

export interface PlanMilestone {
  title: string
  goal: string
  status: 'planned' | 'active' | 'done' | 'blocked'
  steps: string[]
  acceptance: string[]
  proof?: string
  rollback?: string
}

export interface PlanDocument {
  schema: 'openape.plan/1'
  title: string
  goal: string
  status: 'draft' | 'active' | 'done' | 'archived'
  project?: string
  owner?: string
  date?: string
  context?: string
  decisions: PlanDecision[]
  milestones: PlanMilestone[]
  scope: string[]
  nonGoals: string[]
  risks: { title: string, mitigation: string }[]
  verification: string[]
  changelog: { date: string, text: string }[]
  links: { title: string, url: string }[]
  approval?: { by: string, date: string, reference: string }
}

export interface RenderContext {
  commit?: string
  command?: string
  environment?: string
  nextStep?: string
}
