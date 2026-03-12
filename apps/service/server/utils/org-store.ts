import { usePlatformStorage } from './platform-storage'

export interface Org {
  id: string
  slug: string
  name: string
  plan: 'free' | 'payg'
  adminEmails: string[]
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  customDomain?: string
  customDomainVerified: boolean
  createdAt: number
  updatedAt: number
  limits: {
    maxUsers: number
    maxAgents: number
    auditLogDays: number
  }
}

const RESERVED_SLUGS = new Set([
  'www', 'api', 'admin', 'app', 'docs', 'static', 'assets',
  'cdn', 'mail', 'support', 'help', 'status', 'blog',
])

const FREE_LIMITS = { maxUsers: 5, maxAgents: 2, auditLogDays: 7 }
const PAYG_LIMITS = { maxUsers: 10000, maxAgents: 10000, auditLogDays: 90 }

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)
}

export async function createOrg(data: { slug: string, name: string, adminEmails: string[] }): Promise<Org> {
  const storage = usePlatformStorage()

  if (!isValidSlug(data.slug)) {
    throw new Error('Invalid slug: must be lowercase alphanumeric with hyphens, 1-63 chars')
  }
  if (RESERVED_SLUGS.has(data.slug)) {
    throw new Error(`Slug "${data.slug}" is reserved`)
  }

  const existing = await storage.getItem<Org>(`orgs:${data.slug}`)
  if (existing) {
    throw new Error(`Org "${data.slug}" already exists`)
  }

  const org: Org = {
    id: crypto.randomUUID(),
    slug: data.slug,
    name: data.name,
    plan: 'free',
    adminEmails: data.adminEmails,
    customDomainVerified: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    limits: { ...FREE_LIMITS },
  }

  await storage.setItem(`orgs:${data.slug}`, org)
  return org
}

export async function getOrg(slug: string): Promise<Org | null> {
  const storage = usePlatformStorage()
  return await storage.getItem<Org>(`orgs:${slug}`)
}

export async function updateOrg(slug: string, updates: Partial<Pick<Org, 'name' | 'plan' | 'adminEmails' | 'stripeCustomerId' | 'stripeSubscriptionId' | 'customDomain' | 'customDomainVerified' | 'limits'>>): Promise<Org> {
  const storage = usePlatformStorage()
  const org = await storage.getItem<Org>(`orgs:${slug}`)
  if (!org) {
    throw new Error(`Org "${slug}" not found`)
  }

  const updated: Org = {
    ...org,
    ...updates,
    updatedAt: Date.now(),
  }

  // Adjust limits based on plan
  if (updates.plan === 'payg' && org.plan === 'free') {
    updated.limits = { ...PAYG_LIMITS }
  }
  else if (updates.plan === 'free' && org.plan === 'payg') {
    updated.limits = { ...FREE_LIMITS }
  }

  await storage.setItem(`orgs:${slug}`, updated)
  return updated
}

export async function listOrgs(): Promise<Org[]> {
  const storage = usePlatformStorage()
  const keys = await storage.getKeys('orgs:')
  const orgs: Org[] = []
  for (const key of keys) {
    const org = await storage.getItem<Org>(key)
    if (org) orgs.push(org)
  }
  return orgs
}
