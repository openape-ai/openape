import { defineEventHandler } from 'h3'
import { getIssuePolicy } from '../../../../utils/issue-reporting'

export default defineEventHandler(getIssuePolicy)
