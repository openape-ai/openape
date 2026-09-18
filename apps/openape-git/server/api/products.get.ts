import { defineEventHandler } from 'h3'
import { reportingProducts } from '../utils/issue-reporting'

export default defineEventHandler(reportingProducts)
