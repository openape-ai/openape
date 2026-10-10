/**
 * Pods whose tables stay local: members of persistent networks, their invocations, archived Pods and the Pods
 * schema 45 kept local because networks had called their workflows (issue 1455).
 */
export const privatePods = `SELECT pod_id FROM network_members UNION SELECT pod_id FROM network_invocations UNION SELECT id FROM pods WHERE lifecycle='archived' UNION SELECT pod_id FROM local_only_pods`
