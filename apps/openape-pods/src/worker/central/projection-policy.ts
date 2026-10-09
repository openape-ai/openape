/** Pods whose tables stay local: members of persistent networks and their invocations. */
export const privatePods = `SELECT pod_id FROM network_members UNION SELECT pod_id FROM network_invocations`
