export function getCliAuthorizationDetails(details) {
  return (details ?? []).filter((detail) => detail.type === "openape_cli");
}
export function formatCliResourceChain(detail) {
  return detail.resource_chain.map((resource) => {
    const selector = resource.selector && Object.keys(resource.selector).length > 0 ? Object.entries(resource.selector).map(([key, value]) => `${key}=${value}`).join(", ") : "*";
    return `${resource.resource}[${selector}]`;
  }).join(" -> ");
}
export function summarizeCliGrant(details) {
  const cliDetails = getCliAuthorizationDetails(details);
  if (cliDetails.length === 0)
    return null;
  if (cliDetails.length === 1) {
    return cliDetails[0].display;
  }
  const first = cliDetails[0];
  return `${first.cli_id}: ${cliDetails.length} requested operations`;
}
