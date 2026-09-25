import { defineEventHandler } from 'h3'
import { moderateIssue } from '../../../utils/issue-reporting'

export default defineEventHandler(moderateIssue)
