export function normalizeDiscordUsername(value) {
  return String(value ?? '').trim().replace(/^@/, '').toLowerCase();
}

export function normalizeTicketReference(value) {
  const reference = String(value ?? '').trim().toUpperCase();
  return !reference || reference.includes('-') ? reference : `${reference}-1`;
}

export async function findTicketSummary(fetchPage, reference) {
  let page = 1;
  const normalizedReference = normalizeTicketReference(reference);

  while (page) {
    const body = await fetchPage(page);
    const ticket = body.tickets?.find(
      (item) => normalizeTicketReference(item.reference) === normalizedReference,
    );
    if (ticket) return ticket;
    page = body.meta?.next_page;
  }

  return undefined;
}

export function hasDiscordUsernameMismatch(ticket, discordUsername, questionSlug) {
  if (!ticket || ticket.state !== 'complete') return false;

  const registeredUsername = normalizeDiscordUsername(
    ticket.responses?.[questionSlug],
  );
  return (
    registeredUsername !== '' &&
    registeredUsername !== normalizeDiscordUsername(discordUsername)
  );
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
