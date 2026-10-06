import { defineEventHandler } from 'h3'
import { listIssueLabels } from '../../../../../utils/issue-labels'

export default defineEventHandler(listIssueLabels)
