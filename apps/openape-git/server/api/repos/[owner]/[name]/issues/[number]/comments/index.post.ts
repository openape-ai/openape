import { defineEventHandler } from 'h3'
import { createIssueComment } from '../../../../../../../utils/issue-handlers'

export default defineEventHandler(createIssueComment)
