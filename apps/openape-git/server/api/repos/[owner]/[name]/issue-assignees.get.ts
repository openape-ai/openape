import { defineEventHandler } from 'h3'
import { listIssueAssignees } from '../../../../utils/issue-labels'

export default defineEventHandler(listIssueAssignees)
