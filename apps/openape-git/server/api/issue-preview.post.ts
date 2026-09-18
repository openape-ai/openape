import { defineEventHandler } from 'h3'
import { issueBody, issueContext, issueText } from '../utils/issue-api'
import { validateCommentText } from '../utils/issues'
import { renderIssueMarkdown } from '../utils/render'

export default defineEventHandler(async (event) => {
  await issueContext(event, ['issues:create', 'issues:comment', 'issues:edit-own', 'issues:triage', 'reports:create'])
  const input = await issueBody(event, ['body'])
  return { bodyHtml: renderIssueMarkdown(validateCommentText(issueText(input.body, 'body', 400000), 65536)) }
})
