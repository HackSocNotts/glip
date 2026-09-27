export function normalizeDiscordUsername(value) {
  return String(value ?? '').trim().replace(/^@/, '').toLowerCase();
}

export function normalizeTicketReference(value) {
  const reference = String(value ?? '').trim().toUpperCase();
  return !reference || reference.includes('-') ? reference : `${reference}-1`;
}

export function getTicketDiscordUsername(ticket, questionSlug, questionId) {
  const currentAnswer = questionId == null
    ? undefined
    : ticket?.answers?.find(
      (answer) => String(answer.question_id) === String(questionId),
    );
  return currentAnswer?.response
    ?? currentAnswer?.primary_response
    ?? ticket?.responses?.[questionSlug];
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

export async function findAnswersForUsername(fetchPage, username) {
  const normalizedUsername = normalizeDiscordUsername(username);
  if (!normalizedUsername) return [];

  const answers = [];
  let page = 1;
  while (page) {
    const body = await fetchPage(page);
    answers.push(...(body.answers || []).filter(
      (answer) => normalizeDiscordUsername(answer.response) === normalizedUsername,
    ));
    page = body.meta?.next_page;
  }
  return answers;
}

export function hasDiscordUsernameMismatch(ticket, discordUsername, questionSlug, questionId) {
  if (!ticket || ticket.state !== 'complete') return false;

  const registeredUsername = normalizeDiscordUsername(
    getTicketDiscordUsername(ticket, questionSlug, questionId),
  );
  return (
    registeredUsername !== '' &&
    registeredUsername !== normalizeDiscordUsername(discordUsername)
  );
}

export function validateTicket(ticket, discordUsername, questionSlug, questionId) {
  if (!ticket || ticket.state !== 'complete') return false;

  const registeredUsername = getTicketDiscordUsername(
    ticket,
    questionSlug,
    questionId,
  );
  return (
    normalizeDiscordUsername(registeredUsername) !== '' &&
    normalizeDiscordUsername(registeredUsername) ===
      normalizeDiscordUsername(discordUsername)
  );
}
