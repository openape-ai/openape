import { issueContext } from '../../utils/issue-api'
import { downloadIssueAttachment } from '../../utils/issue-imports'

export default defineEventHandler(async event => downloadIssueAttachment(event, await issueContext(event, ['issues:read'])))
