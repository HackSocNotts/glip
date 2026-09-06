import {
  ActivityType,
  Client,
  escapeMarkdown,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';
import {
  normalizeTicketReference,
  validateTicket,
} from './verify.mjs';

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

const verifyCommand = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Verify your HackNotts ticket')
  .addStringOption((option) =>
    option
      .setName('ticket')
      .setDescription('Your Ti.to ticket reference, for example IGLN-6')
      .setRequired(true)
      .setMaxLength(32),
  );

const rest = new REST().setToken(DISCORD_TOKEN);
await rest.put(
  Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID),
  { body: [verifyCommand.toJSON()] },
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

async function getTicket(reference) {
  const url = new URL(
    `https://api.tito.io/v3/${encodeURIComponent(TITO_ACCOUNT_SLUG)}/${encodeURIComponent(TITO_EVENT_SLUG)}/tickets`,
  );
  url.searchParams.set('q', reference);
  url.searchParams.set('view', 'extended');

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Token token=${TITO_API_TOKEN}`,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Ti.to returned HTTP ${response.status}`);

  const body = await response.json();
  return body.tickets?.find(
    (ticket) => normalizeTicketReference(ticket.reference) === reference,
  );
}

const failureMessage =
  'That seems to be an invalid ticket number, please double check and try again.';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'verify') {
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (!interaction.inGuild() || interaction.guildId !== DISCORD_GUILD_ID) {
      await interaction.editReply('Run this command inside the HackNotts server.');
      return;
    }

    if (isRateLimited(interaction.user.id)) {
      await interaction.editReply('Too many attempts. Please try again later.');
      return;
    }

    const reference = normalizeTicketReference(
      interaction.options.getString('ticket', true),
    );
    if (!/^[A-Z0-9-]{3,32}$/.test(reference)) {
      await interaction.editReply(failureMessage);
      return;
    }

    const ticket = await getTicket(reference);
    if (!validateTicket(ticket, interaction.user.username, questionSlug)) {
      await interaction.editReply(failureMessage);
      return;
    }

    const ticketRoleId = ticketRoleIds[ticket.release_slug];
    if (!ticketRoleId) {
      throw new Error(`No Discord role configured for Ti.to release ${ticket.release_slug}`);
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    const requiredRoleIds = [VERIFIED_ROLE_ID, ticketRoleId];
    const missingRoleIds = requiredRoleIds.filter(
      (roleId) => !member.roles.cache.has(roleId),
    );
    if (!missingRoleIds.length) {
      await interaction.editReply('You have already been verified!');
      return;
    }

    await member.roles.add(
      missingRoleIds,
      `Verified Ti.to ${ticket.release_slug} ticket ${reference}`,
    );

    try {
      const logChannel = await interaction.guild.channels.fetch(
        VERIFICATION_LOG_CHANNEL_ID,
      );
      if (!logChannel?.isTextBased()) {
        throw new Error('Verification log channel is not text-based');
      }
      await logChannel.send({
        content: `${escapeMarkdown(ticket.name || 'Unknown attendee')} (<@${interaction.user.id}>) was verified and given the <@&${ticketRoleId}> role.`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error('Could not post verification update:', error);
    }

    await interaction.editReply(
      `Thank you for verifying your ticket! You have been given the <@&${ticketRoleId}> role.`,
    );
  } catch (error) {
    console.error('Verification failed:', error);
    await interaction.editReply('Verification is temporarily unavailable. Please try again later.');
  }
});

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
