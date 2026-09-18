import { defineEventHandler } from 'h3'
import { updateIssueComment } from '../../../../utils/issue-handlers'

export default defineEventHandler(updateIssueComment)
