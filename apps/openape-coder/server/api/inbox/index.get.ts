// story: coder-invite-members (criterion 8) — #585.
//
// The signed-in user's inbox: the "you were added to project X by Y"
// notifications that have not been dismissed yet. requireUser realises any
// pending invites first, so an invite accepted on this very sign-in already
// shows up here.

export default defineEventHandler(async (event) => {
  const email = await requireUser(event)
  return useMembershipStore().listInbox(email)
})
