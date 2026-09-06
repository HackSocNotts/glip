export function normalizeDiscordUsername(value) {
  return String(value ?? '').trim().replace(/^@/, '').toLowerCase();
}

export function normalizeTicketReference(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function validateTicket(ticket, discordUsername, questionSlug) {
  if (!ticket || ticket.state !== 'complete') return false;

  const registeredUsername = ticket.responses?.[questionSlug];
  return (
    normalizeDiscordUsername(registeredUsername) !== '' &&
    normalizeDiscordUsername(registeredUsername) ===
      normalizeDiscordUsername(discordUsername)
  );
}
