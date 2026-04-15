const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const { getTicketData, deleteTicketData } = require('../utils/ticketManager');
const { buildTranscript } = require('../utils/transcriptBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('close')
        .setDescription('Ticket management commands.')
        .addSubcommand(sub =>
            sub
                .setName('now')
                .setDescription('Close and archive this ticket immediately. (Claimer only)')
        )
        .addSubcommand(sub =>
            sub
                .setName('request')
                .setDescription('Send a close request to the ticket creator. (Claimer only)')
                .addStringOption(option =>
                    option
                        .setName('reason')
                        .setDescription('Reason for the close request')
                        .setRequired(true)
                        .setMaxLength(500)
                )
        ),

    async execute(interaction, client) {
        const sub = interaction.options.getSubcommand();
        const ticket = getTicketData(client, interaction.channel.id);

        if (!ticket) {
            return interaction.reply({ content: 'This command can only be used inside a ticket channel.', flags: 64 });
        }

        const isClaimer  = ticket.claimedBy === interaction.user.id;
        const isCreator  = ticket.creatorId === interaction.user.id;

        if (!isClaimer && !isCreator) {
            return interaction.reply({ content: 'Only the staff member who claimed this ticket or the ticket creator can use this command.', flags: 64 });
        }

        // ── /close request ──────────────────────────────────────────────────────
        if (sub === 'request') {
            if (!isClaimer) {
                return interaction.reply({ content: 'Only the staff member who claimed this ticket can send a close request.', flags: 64 });
            }

            const reason = interaction.options.getString('reason');

            const requestEmbed = new EmbedBuilder()
                .setTitle('📋 Close Request')
                .setColor(0xED4245)
                .setDescription(
                    `<@${ticket.creatorId}>, the staff member handling your ticket has requested to close it.\n` +
                    `Please review the reason below and accept or decline.`
                )
                .addFields(
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Requested By', value: `${interaction.user} (${interaction.user.username})`, inline: true },
                    { name: 'Ticket', value: `#${ticket.ticketNumber || interaction.channel.name}`, inline: true },
                )
                .setTimestamp()
                .setFooter({ text: 'You have 5 minutes to accept or decline.' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`ticket_close_accept:${interaction.channel.id}`)
                    .setLabel('Accept & Close')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId(`ticket_close_decline:${interaction.channel.id}`)
                    .setLabel('Decline')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('❌'),
            );

            await interaction.reply({ embeds: [requestEmbed], components: [row] });

            // Auto-expire after 5 minutes
            setTimeout(async () => {
                try {
                    const msg = await interaction.fetchReply().catch(() => null);
                    if (msg && msg.components.length > 0) {
                        const expiredRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`ticket_close_expired`)
                                .setLabel('Request Expired')
                                .setStyle(ButtonStyle.Secondary)
                                .setDisabled(true),
                        );
                        await msg.edit({ components: [expiredRow] }).catch(() => {});
                    }
                } catch {}
            }, 5 * 60 * 1000);

            return;
        }

        // ── /close now ──────────────────────────────────────────────────────────
        if (sub === 'now') {
            await interaction.deferReply({ flags: 64 });
            await closeTicket(interaction.channel, ticket, interaction.user, client);
            await interaction.editReply({ content: 'Ticket closed and transcript sent.' });
        }
    },
};

/**
 * Closes a ticket: sends transcript, deletes channel.
 * Exported so button handlers can call it too.
 */
async function closeTicket(channel, ticket, closedBy, client) {
    const settings = client.settings.get(channel.guild.id) || {};
    const transcriptChannelId = settings.ticketTranscriptChannelId;

    try {
        const { embed, attachment } = await buildTranscript(channel, ticket, closedBy);

        const tasks = [];

        // Send to transcript channel
        if (transcriptChannelId) {
            const transcriptChannel = channel.guild.channels.cache.get(transcriptChannelId);
            if (transcriptChannel) {
                tasks.push(
                    transcriptChannel.send({ embeds: [embed], files: [attachment] })
                        .catch(e => console.warn('[Ticket] Could not send transcript:', e.message))
                );
            }
        }

        // DM the ticket creator — run in parallel with transcript send
        tasks.push((async () => {
            try {
                const creator = await channel.guild.members.fetch(ticket.creatorId).catch(() => null);
                if (creator) {
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('Your Ticket Has Been Closed')
                        .setColor(0x2B2D75)
                        .setDescription(`Your ticket in **${channel.guild.name}** has been closed.`)
                        .addFields(
                            { name: 'Ticket',    value: `#${ticket.ticketNumber || channel.name}`, inline: true },
                            { name: 'Closed By', value: closedBy?.username || 'Staff',             inline: true },
                            { name: 'Reason',    value: ticket.reason || 'No reason provided',     inline: false },
                        )
                        .setTimestamp();
                    await creator.send({ embeds: [dmEmbed], files: [attachment] }).catch(() => {});
                }
            } catch {}
        })());

        await Promise.all(tasks);
    } catch (err) {
        console.error('[Ticket] Error building transcript:', err.message);
    }

    deleteTicketData(client, channel.id);

    setTimeout(() => {
        channel.delete(`Ticket closed by ${closedBy?.username || 'staff'}`).catch(e => {
            console.warn('[Ticket] Could not delete channel:', e.message);
        });
    }, 2000);
}

module.exports.closeTicket = closeTicket;
