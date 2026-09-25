import { issueContext } from '../utils/issue-api'
import { resolveLegacyIssue } from '../utils/issue-imports'

export default defineEventHandler(async event => resolveLegacyIssue(event, await issueContext(event, ['issues:read'])))
