import { defineEventHandler } from 'h3'
import { unlinkIssuePull } from '../../../../../../../utils/issue-pulls'

export default defineEventHandler(unlinkIssuePull)
