const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
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
            // Reply BEFORE deletion finishes so the ephemeral spinner resolves.
            await interaction.editReply({ content: 'Closing ticket — generating transcript and deleting channel...' });
            const result = await closeTicket(interaction.channel, ticket, interaction.user, client);
            if (!result.ok) {
                // Channel was NOT deleted — surface the error to the closer.
                await interaction.followUp({
                    content: `Ticket close failed: \`${result.error}\`. See the channel for details.`,
                    flags: 64,
                }).catch(() => {});
            }
        }
    },
};

/**
 * Closes a ticket: sends transcript, deletes channel.
 * Exported so button handlers can call it too.
 *
 * Returns: { ok: boolean, error?: string }
 */
async function closeTicket(channel, ticket, closedBy, client) {
    const settings = client.settings.get(channel.guild.id) || {};
    const transcriptChannelId = settings.ticketTranscriptChannelId;

    // ── Preflight: do we even have ManageChannels here? ───────────────────────
    const me = channel.guild.members.me;
    const myPerms = channel.permissionsFor(me);
    if (!myPerms?.has(PermissionFlagsBits.ManageChannels)) {
        const msg = 'I cannot delete this channel — I am missing **Manage Channels** permission on this category. Ask an admin to grant the bot Manage Channels on the ticket category, then try again.';
        console.warn(`[Ticket] Close aborted: bot lacks ManageChannels on #${channel.name}`);
        await channel.send({
            embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('Close Failed').setDescription(msg)],
        }).catch(() => {});
        return { ok: false, error: 'missing_manage_channels' };
    }

    // ── Build transcript and gather destinations ──────────────────────────────
    let transcriptAttachment = null;
    let summaryEmbed = null;
    let messageCount = 0;
    try {
        const built = await buildTranscript(channel, ticket, closedBy);
        transcriptAttachment = built.attachment;
        summaryEmbed = built.embed;
        messageCount = built.messageCount ?? 0;
    } catch (err) {
        console.error('[Ticket] Error building transcript:', err.message, err.stack);
        // Continue anyway — we still want to close the channel.
        summaryEmbed = new EmbedBuilder()
            .setTitle(`Ticket Closed — #${channel.name}`)
            .setColor(0xED4245)
            .setDescription('Transcript could not be generated for this ticket.')
            .addFields(
                { name: 'Ticket',    value: `#${ticket.ticketNumber || channel.name}`,         inline: true },
                { name: 'Opened By', value: ticket.creatorId ? `<@${ticket.creatorId}>` : '—', inline: true },
                { name: 'Closed By', value: closedBy?.username || 'Staff',                    inline: true },
            )
            .setTimestamp();
    }

    // ── Post transcript to log channel ────────────────────────────────────────
    const sendTasks = [];
    if (transcriptChannelId) {
        const transcriptChannel = channel.guild.channels.cache.get(transcriptChannelId);
        if (transcriptChannel) {
            const payload = { embeds: [summaryEmbed] };
            if (transcriptAttachment) payload.files = [transcriptAttachment];
            sendTasks.push(
                transcriptChannel.send(payload)
                    .catch(e => console.warn('[Ticket] Could not send transcript to log channel:', e.message))
            );
        } else {
            console.warn(`[Ticket] Configured transcript channel ${transcriptChannelId} not found in cache.`);
        }
    } else {
        console.warn('[Ticket] No ticketTranscriptChannelId configured — transcript not posted.');
    }

    // ── DM the ticket creator ────────────────────────────────────────────────
    sendTasks.push((async () => {
        try {
            const creator = await channel.guild.members.fetch(ticket.creatorId).catch(() => null);
            if (!creator) return;
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
            const dmPayload = { embeds: [dmEmbed] };
            if (transcriptAttachment) dmPayload.files = [transcriptAttachment];
            await creator.send(dmPayload).catch(() => {});
        } catch {}
    })());

    await Promise.all(sendTasks);

    deleteTicketData(client, channel.id);

    // ── Delete the channel — await so failures surface ────────────────────────
    try {
        await channel.delete(`Ticket closed by ${closedBy?.username || 'staff'}`);
        return { ok: true };
    } catch (err) {
        console.error('[Ticket] Failed to delete channel:', err.message);
        await channel.send({
            embeds: [new EmbedBuilder()
                .setColor(0xED4245)
                .setTitle('Channel Delete Failed')
                .setDescription(`I sent the transcript but could not delete this channel. Reason: \`${err.message}\``)],
        }).catch(() => {});
        return { ok: false, error: err.message };
    }
}

module.exports.closeTicket = closeTicket;
