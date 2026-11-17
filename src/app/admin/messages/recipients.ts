// The explicit "everyone" choice of the compose form. Kept out of actions.ts,
// which as a "use server" module may only export async functions.
//
// It is a value of its own, never the empty string: an empty recipient used
// to mean "all users", and it was also the form's default, so a note meant
// for one person went to every account, in the chat and by e-mail.
export const ALL_USERS = "all";
