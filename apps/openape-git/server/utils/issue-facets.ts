import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { issueLabelLinks, issueLabels, issues, products, repos } from '../database/schema'
import { principalAllows, readableIssuePredicate, repositoryAccessPredicate } from './issue-access'
import { issueContext } from './issue-api'

export async function issueFacets(event: H3Event) {
  const { db, principal, audience } = await issueContext(event, ['issues:read'])
  const visible = readableIssuePredicate(principal, audience)
  const [repositories, labels, productChoices, assignees] = await Promise.all([
    db.select({ owner: repos.owner, name: repos.name }).from(repos).where(repositoryAccessPredicate(principal.subject, audience)).orderBy(repos.owner, repos.name),
    db.selectDistinct({ id: issueLabels.id, name: issueLabels.name }).from(issueLabels).innerJoin(issueLabelLinks, eq(issueLabelLinks.labelId, issueLabels.id)).innerJoin(issues, eq(issues.id, issueLabelLinks.issueId)).where(visible).orderBy(issueLabels.name),
    db.selectDistinct({ key: products.key, name: products.name }).from(products).innerJoin(issues, eq(issues.productKey, products.key)).where(visible).orderBy(products.name),
    db.selectDistinct({ subject: issues.assignee }).from(issues).where(visible).orderBy(issues.assignee),
  ])
  return { repositories, labels, products: productChoices, assignees: assignees.map(row => row.subject).filter(Boolean), canCreate: principalAllows(principal, 'issues:create') }
}
