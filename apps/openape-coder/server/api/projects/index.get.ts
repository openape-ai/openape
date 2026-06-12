// story: coder-sign-in (criteria 1, 2), coder-projects (criterion 4) — #585.
//
// Project overview of the signed-in identity: exactly the projects she is a
// member of (admin or member), nothing else. A membership-less identity gets an
// empty list — never a hint that foreign projects or people exist.
export default defineEventHandler(async (event) => {
  const email = await requireUser(event)
  return useProjectStore().listForMember(email)
})
