import { defineEventHandler } from 'h3'
import { listPullIssues } from '../../../../../../utils/issue-pulls'

export default defineEventHandler(listPullIssues)
