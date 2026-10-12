/**
 * Pods whose tables stay local: archived Pods and the Pods the owner keeps local, among them the former network
 * members whose runs hold mail-derived business data (issues 1455 and 1465).
 */
export const privatePods = `SELECT id AS pod_id FROM pods WHERE lifecycle='archived' UNION SELECT pod_id FROM local_only_pods`
