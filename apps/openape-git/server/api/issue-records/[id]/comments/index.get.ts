import { defineEventHandler } from 'h3'
import { listIssueComments } from '../../../../utils/issue-handlers'

export default defineEventHandler(listIssueComments)
