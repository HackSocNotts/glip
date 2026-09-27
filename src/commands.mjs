import {
  escapeMarkdown,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import {
  getTicketDiscordUsername,
  hasDiscordUsernameMismatch,
  normalizeDiscordUsername,
  normalizeTicketReference,
  validateTicket,
} from './verify.mjs';

const verifyCommand = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Verify your HackNotts ticket')
  .addStringOption((option) =>
    option
      .setName('ticket')
      .setDescription('Your ticket reference, for example IGLN-6')
      .setRequired(true)
      .setMaxLength(32),
  )
  .addUserOption((option) =>
    option
      .setName('user')
      .setDescription('Admin only: verify this server member instead of yourself'),
  );

const checkTicketCommand = new SlashCommandBuilder()
  .setName('checkticket')
  .setDescription('Look up an attendee by ticket reference')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) =>
    option
      .setName('ticketreference')
      .setDescription('Ticket reference, for example IGLN-6')
      .setRequired(true)
      .setMaxLength(32),
  );

const checkUserCommand = new SlashCommandBuilder()
  .setName('checkuser')
  .setDescription('Look up tickets by Discord username or user mention')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) =>
    option
      .setName('user')
      .setDescription('Discord username, @mention, or user ID')
      .setRequired(true)
      .setMaxLength(100),
  );

export const commands = [verifyCommand, checkTicketCommand, checkUserCommand];

async function replyWithTickets(interaction, tickets, questionSlug, questionId) {
  if (!tickets.length) {
    await interaction.editReply('No matching tickets found. Check the ticket reference or registered Discord username.');
    return;
  }

  const details = tickets.map((ticket) => {
    const field = (value) => escapeMarkdown(String(value || 'Not provided'));
    return `Name: ${field(ticket.name)}\nUsername: ${field(getTicketDiscordUsername(ticket, questionSlug, questionId))}\nTicket ref: ${field(ticket.reference)}\nStatus: ${field(ticket.state)}`;
  }).join('\n\n');
  await interaction.editReply({
    content: details.length <= 2000 ? details : `Found ${tickets.length} tickets.`,
    files: details.length <= 2000 ? [] : [{ attachment: Buffer.from(details), name: 'tickets.txt' }],
    allowedMentions: { parse: [] },
  });
}

export function createCommandHandler({
  guildId: DISCORD_GUILD_ID,
  verifiedRoleId: VERIFIED_ROLE_ID,
  logChannelId: VERIFICATION_LOG_CHANNEL_ID,
  questionSlug,
  questionId,
  ticketRoleIds,
  getTicket,
  getTicketsForUser,
  isRateLimited,
}) {
  const failureMessage =
    'That seems to be an invalid ticket number, please double check and try again.';

  return async (interaction) => {
    if (!interaction.isChatInputCommand() || !commands.some((command) => command.name === interaction.commandName)) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      if (!interaction.inGuild() || interaction.guildId !== DISCORD_GUILD_ID) {
        await interaction.editReply('wrong server. update env');
        return;
      }

      const isLookup = interaction.commandName !== 'verify';
      const selectedUser = isLookup ? null : interaction.options.getUser('user');
      const isAdministrator = interaction.memberPermissions?.has(
        PermissionFlagsBits.Administrator,
      );
      if ((isLookup || selectedUser) && !isAdministrator) {
        await interaction.editReply('Only administrators can use this command.');
        return;
      }

      if (!isAdministrator && isRateLimited(interaction.user.id)) {
        await interaction.editReply('Too many attempts. Try again later.');
        return;
      }

      if (interaction.commandName === 'checkuser') {
        const input = interaction.options.getString('user', true).trim();
        const userId = input.match(/^<@!?(\d+)>$/)?.[1] || input.match(/^\d{17,20}$/)?.[0];
        const username = userId
          ? (await interaction.client.users.fetch(userId)).username
          : normalizeDiscordUsername(input);
        await replyWithTickets(interaction, await getTicketsForUser(username), questionSlug, questionId);
        return;
      }

      const reference = normalizeTicketReference(
        interaction.options.getString(isLookup ? 'ticketreference' : 'ticket', true),
      );
      if (!/^[A-Z0-9-]{3,32}$/.test(reference)) {
        await interaction.editReply(failureMessage);
        return;
      }

      const ticket = await getTicket(reference);
      if (isLookup) {
        await replyWithTickets(interaction, ticket ? [ticket] : [], questionSlug, questionId);
        return;
      }

      const targetUser = selectedUser || interaction.user;
      if (hasDiscordUsernameMismatch(ticket, targetUser.username, questionSlug, questionId)) {
        await interaction.editReply(
          `The Discord username on this ticket does not match ${selectedUser ? 'the selected user' : 'your account'}. Please update it in your ticket to \`${targetUser.username}\`, then run \`/verify\` again.`,
        );
        return;
      }

      if (!validateTicket(ticket, targetUser.username, questionSlug, questionId)) {
        await interaction.editReply(failureMessage);
        return;
      }

      const ticketRoleId = ticketRoleIds[ticket.release_slug];
      if (!ticketRoleId) {
        throw new Error(`No role configured for ${ticket.release_slug}`);
      }

      const member = await interaction.guild.members.fetch(targetUser.id);
      const requiredRoleIds = [VERIFIED_ROLE_ID, ticketRoleId];
      const missingRoleIds = requiredRoleIds.filter(
        (roleId) => !member.roles.cache.has(roleId),
      );
      if (!missingRoleIds.length) {
        await interaction.editReply(selectedUser ? 'That user has already been verified!' : 'You have already been verified!');
        return;
      }

      await member.roles.add(
        missingRoleIds,
        `Verified ${ticket.release_slug} ticket ${reference}${selectedUser ? ` by admin ${interaction.user.id}` : ''}`,
      );

      try {
        const logChannel = await interaction.guild.channels.fetch(
          VERIFICATION_LOG_CHANNEL_ID,
        );
        if (!logChannel?.isTextBased()) {
          throw new Error('');
        }
        await logChannel.send({
          content: `${escapeMarkdown(ticket.name || 'unknown attendee')} (<@${targetUser.id}>) was verified${selectedUser ? ` by admin <@${interaction.user.id}>` : ''} and given the <@&${ticketRoleId}> role.`,
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        console.error('Could not post verification:', error);
      }

      await interaction.editReply(
        selectedUser
          ? `<@${targetUser.id}> has been verified and given the <@&${ticketRoleId}> role.`
          : `Thank you for verifying your ticket! You have been given the <@&${ticketRoleId}> role.`,
      );
    } catch (error) {
      console.error('Ticket command failed:', error);
      await interaction.editReply('Could not complete the ticket command. Please try again, or inform an organiser.');
    }
  };
}
