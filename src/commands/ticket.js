const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
} = require('discord.js');
const { getTicketData } = require('../utils/ticketManager');

const SUPPORT_ROLE_ID = '1488210128187560169';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Manage users in the current ticket.')
        .addSubcommand(sub =>
            sub
                .setName('add')
                .setDescription('Add a user to this ticket channel.')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('The user to add to the ticket')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('remove')
                .setDescription('Remove a user from this ticket channel.')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('The user to remove from the ticket')
                        .setRequired(true)
                )
        ),

    async execute(interaction, client) {
        const ticket = getTicketData(client, interaction.channel.id);

        if (!ticket) {
            return interaction.reply({
                content: 'This command can only be used inside a ticket channel.',
                flags: 64,
            });
        }

        const settings      = client.settings.get(interaction.guild.id) || {};
        const supportRoleId = settings.ticketSupportRoleId || SUPPORT_ROLE_ID;
        const hasRole       = interaction.member.roles.cache.has(supportRoleId);
        const isAdmin       = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        const isClaimer     = ticket.claimedBy === interaction.user.id;

        if (!hasRole && !isAdmin && !isClaimer) {
            return interaction.reply({
                content: 'Only support staff or the ticket claimer can manage ticket members.',
                flags: 64,
            });
        }

        const sub    = interaction.options.getSubcommand();
        const target = interaction.options.getMember('user');

        if (!target) {
            return interaction.reply({ content: 'That user could not be found in this server.', flags: 64 });
        }

        if (target.id === interaction.user.id) {
            return interaction.reply({ content: 'You cannot add or remove yourself.', flags: 64 });
        }

        if (target.id === client.user.id) {
            return interaction.reply({ content: 'You cannot modify my permissions.', flags: 64 });
        }

        if (sub === 'add') {
            try {
                await interaction.channel.permissionOverwrites.edit(target.id, {
                    ViewChannel:        true,
                    SendMessages:       true,
                    ReadMessageHistory: true,
                    AttachFiles:        true,
                });

                const embed = new EmbedBuilder()
                    .setColor(0x57F287)
                    .setDescription(`✅ ${target} has been added to this ticket by ${interaction.user}.`)
                    .setTimestamp();

                return interaction.reply({ embeds: [embed] });
            } catch (err) {
                console.error('[Ticket] Failed to add user:', err.message);
                return interaction.reply({
                    content: 'Failed to add the user. Make sure I have permission to manage this channel.',
                    flags: 64,
                });
            }
        }

        if (sub === 'remove') {
            if (target.id === ticket.creatorId) {
                return interaction.reply({
                    content: 'You cannot remove the ticket creator from their own ticket.',
                    flags: 64,
                });
            }

            try {
                await interaction.channel.permissionOverwrites.edit(target.id, {
                    ViewChannel:        false,
                    SendMessages:       false,
                    ReadMessageHistory: false,
                });

                const embed = new EmbedBuilder()
                    .setColor(0xED4245)
                    .setDescription(`🚫 ${target} has been removed from this ticket by ${interaction.user}.`)
                    .setTimestamp();

                return interaction.reply({ embeds: [embed] });
            } catch (err) {
                console.error('[Ticket] Failed to remove user:', err.message);
                return interaction.reply({
                    content: 'Failed to remove the user. Make sure I have permission to manage this channel.',
                    flags: 64,
                });
            }
        }
    },
};
