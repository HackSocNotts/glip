import {
  ActivityType,
  Client,
  GatewayIntentBits,
  REST,
  Routes,
} from 'discord.js';
import {
  findAnswersForUsername,
  findTicketSummary,
} from './verify.mjs';
import { commands, createCommandHandler } from './commands.mjs';

const requiredEnvironment = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_GUILD_ID',
  'VERIFIED_ROLE_ID',
  'HACKER_ROLE_ID',
  'VOLUNTEER_ROLE_ID',
  'SPONSOR_ROLE_ID',
  'VERIFICATION_LOG_CHANNEL_ID',
  'TITO_API_TOKEN',
  'TITO_ACCOUNT_SLUG',
  'TITO_EVENT_SLUG',
];

const missingEnvironment = requiredEnvironment.filter(
  (name) => !process.env[name],
);
if (missingEnvironment.length) {
  throw new Error(`Missing environment variables: ${missingEnvironment.join(', ')}`);
}

const {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  DISCORD_GUILD_ID,
  VERIFIED_ROLE_ID,
  HACKER_ROLE_ID,
  VOLUNTEER_ROLE_ID,
  SPONSOR_ROLE_ID,
  VERIFICATION_LOG_CHANNEL_ID,
  TITO_API_TOKEN,
  TITO_ACCOUNT_SLUG,
  TITO_EVENT_SLUG,
} = process.env;
const questionSlug = process.env.TITO_QUESTION_SLUG || 'discord-username';
const ticketRoleIds = {
  hacker: HACKER_ROLE_ID,
  volunteer: VOLUNTEER_ROLE_ID,
  sponsor: SPONSOR_ROLE_ID,
};

const rest = new REST().setToken(DISCORD_TOKEN);
await rest.put(
  Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID),
  { body: commands.map((command) => command.toJSON()) },
);

const attempts = new Map();
const attemptWindowMs = 15 * 60 * 1_000;
const maximumAttempts = 5;

function isRateLimited(userId) {
  const cutoff = Date.now() - attemptWindowMs;
  const recent = (attempts.get(userId) || []).filter((time) => time > cutoff);
  if (recent.length >= maximumAttempts) return true;
  recent.push(Date.now());
  attempts.set(userId, recent);
  return false;
}

async function fetchTito(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Token token=${TITO_API_TOKEN}`,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Ti.to returned HTTP ${response.status}`);

  return response.json();
}

async function getTicketPage(page) {
  const url = new URL(
    `https://api.tito.io/v3/${encodeURIComponent(TITO_ACCOUNT_SLUG)}/${encodeURIComponent(TITO_EVENT_SLUG)}/tickets`,
  );
  url.searchParams.set('page[size]', '1000');
  url.searchParams.set('page[number]', page);
  for (const state of ['complete', 'incomplete', 'unassigned', 'void', 'archived']) {
    url.searchParams.append('search[states][]', state);
  }
  return fetchTito(url);
}

async function getQuestionAnswerPage(page) {
  const url = new URL(
    `https://api.tito.io/v3/${encodeURIComponent(TITO_ACCOUNT_SLUG)}/${encodeURIComponent(TITO_EVENT_SLUG)}/questions/${encodeURIComponent(questionSlug)}/answers`,
  );
  url.searchParams.set('page[size]', '1000');
  url.searchParams.set('page[number]', page);
  return fetchTito(url);
}

async function getTicketBySlug(slug) {
  const url = new URL(
    `https://api.tito.io/v3/${encodeURIComponent(TITO_ACCOUNT_SLUG)}/${encodeURIComponent(TITO_EVENT_SLUG)}/tickets/${encodeURIComponent(slug)}`,
  );
  const body = await fetchTito(url);
  return body.ticket;
}

async function getTicketsForUser(username) {
  const answers = await findAnswersForUsername(getQuestionAnswerPage, username);
  return Promise.all(answers.map((answer) => getTicketBySlug(answer.ticket_slug)));
}

async function getTicket(reference) {
  const ticketSummary = await findTicketSummary(getTicketPage, reference);
  if (!ticketSummary) return undefined;
  return getTicketBySlug(ticketSummary.slug);
}

async function getQuestionId() {
  const url = new URL(
    `https://api.tito.io/v3/${encodeURIComponent(TITO_ACCOUNT_SLUG)}/${encodeURIComponent(TITO_EVENT_SLUG)}/questions`,
  );
  url.searchParams.set('page[size]', '1000');
  const body = await fetchTito(url);
  const question = body.questions?.find((item) => item.slug === questionSlug);
  if (!question) throw new Error(`Ti.to question not found: ${questionSlug}`);
  return question.id;
}

const questionId = await getQuestionId();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.on('interactionCreate', createCommandHandler({
  guildId: DISCORD_GUILD_ID,
  verifiedRoleId: VERIFIED_ROLE_ID,
  logChannelId: VERIFICATION_LOG_CHANNEL_ID,
  questionSlug,
  questionId,
  ticketRoleIds,
  getTicket,
  getTicketsForUser,
  isRateLimited,
}));

client.once('clientReady', (readyClient) => {
  readyClient.user.setPresence({
    activities: [
      { name: 'Preparing for HackNotts', type: ActivityType.Playing },
    ],
    status: 'online',
  });
  console.log(`Logged in as ${readyClient.user.tag}`);
});

await client.login(DISCORD_TOKEN);
