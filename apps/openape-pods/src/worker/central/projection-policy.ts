/** Pods whose tables stay local: members of persistent networks, their invocations and workflows called by a network. */
export const privatePods = `SELECT pod_id FROM network_members UNION SELECT pod_id FROM network_invocations UNION SELECT m.pod_id FROM workflow_members m JOIN workflow_call_requests c ON c.workflow_id=m.workflow_id`
