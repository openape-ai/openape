import { defineEventHandler } from 'h3'
import { listIssues } from '../utils/issue-handlers'

export default defineEventHandler(listIssues)
