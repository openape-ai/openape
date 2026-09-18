const repo = '/api/repos/:owner/:name'
const issue = `${repo}/issues/:number`
const record = '/api/issue-records/:id'

export const issueScopes = [
  { id: 'issues:read', description: 'Read issues you may access.', grants: ['GET /api/issues', `GET ${repo}/metadata`, 'GET /api/issue-facets', `GET ${repo}/issues`, `GET ${issue}`, `GET ${record}`, `GET ${issue}/comments`, `GET ${record}/comments`, `GET ${repo}/labels`, `GET ${issue}/pulls`, `GET ${record}/pulls`, `GET ${repo}/pulls/:number/issues`, 'GET /api/issue-attachments/:id', 'GET /api/issue-legacy'] },
  { id: 'issues:create', description: 'Open issues in accessible repositories.', grants: ['POST /api/issue-preview', `POST ${repo}/issues`] },
  { id: 'issues:comment', description: 'Comment on accessible issues.', grants: ['POST /api/issue-preview', `POST ${issue}/comments`, `POST ${record}/comments`] },
  { id: 'issues:edit-own', description: 'Edit your own issue and comment text.', grants: ['POST /api/issue-preview', `PATCH ${issue}`, `PATCH ${record}`, `PATCH ${issue}/comments/:commentId`, `PATCH ${record}/comments/:commentId`] },
  { id: 'issues:triage', description: 'Triage issues where you have maintainer access.', grants: ['POST /api/issue-preview', `PATCH ${issue}`, `PATCH ${record}`, `POST ${issue}/transfer`, `POST ${record}/transfer`, `GET ${issue}/transfer-options`, `GET ${record}/transfer-options`, `POST ${issue}/pulls`, `POST ${record}/pulls`, `DELETE ${issue}/pulls/:pullId`, `DELETE ${record}/pulls/:pullId`, `GET ${repo}/issue-assignees`] },
  { id: 'issues:admin', description: 'Manage issue labels, routing and moderation with repository admin access.', grants: [`POST ${repo}/labels`, `PATCH ${repo}/labels/:labelId`, `PUT ${repo}/issue-products/:key`, `POST ${issue}/moderation`, `POST ${record}/moderation`, `GET ${repo}/issue-policy`, `PATCH ${repo}/issue-policy`, `PATCH ${issue}/comments/:commentId`, `PATCH ${record}/comments/:commentId`] },
  { id: 'reports:create', description: 'Report a problem to an enabled product.', grants: ['POST /api/issue-preview', 'POST /api/reports'] },
  { id: 'products:read', description: 'Read safe product reporting choices.', grants: ['GET /api/products'] },
]
