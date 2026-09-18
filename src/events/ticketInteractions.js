const {
    Events,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    PermissionFlagsBits,
} = require('discord.js');

const {
    createTicket,
    createStaffReportTicket,
    buildUpdatedContainer,
    getTicketAttachments,
} = require('./ticketActions');

const {
    getTicketData,
    setTicketData,
} = require('../utils/ticketManager');

const { closeTicket } = require('../commands/close');

async function safeDefer(interaction, ephemeral = true) {
    if (interaction.deferred || interaction.replied) return;
    try {
        await interaction.deferReply({ flags: ephemeral ? 64 : 0 });
    } catch (e) {
        console.warn('[TicketUI] Could not defer:', e.message);
    }
}

async function safeReply(interaction, payload) {
    try {
        if (interaction.deferred) return await interaction.editReply(payload);
        if (interaction.replied)  return await interaction.followUp({ ...payload, flags: 64 });
        return await interaction.reply({ ...payload, flags: 64 });
    } catch (e) {
        if (e.code !== 10062) console.warn('[TicketUI] safeReply failed:', e.message);
    }
}

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        try {
            // ── Ticket type dropdown ───────────────────────────────────────────
            if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_type_select') {
                const value = interaction.values[0];

                if (value === 'general_support') {
                    const modal = new ModalBuilder()
                        .setCustomId('ticket_general_modal')
                        .setTitle('General Support Ticket');

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('reason')
                                .setLabel('What do you need help with?')
                                .setStyle(TextInputStyle.Paragraph)
                                .setRequired(true)
                                .setMaxLength(1000)
                                .setPlaceholder('Give us as much detail as possible so we can help you quickly.')
                        )
                    );
                    return interaction.showModal(modal);
                }

                if (value === 'staff_report') {
                    const modal = new ModalBuilder()
                        .setCustomId('ticket_report_modal')
                        .setTitle('Staff / Player Report');

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('reported_user')
                                .setLabel('Reported User (@mention or ID)')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                                .setMaxLength(120)
                                .setPlaceholder('e.g. @Someone or 848356730256883744')
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('description')
                                .setLabel('Describe what happened')
                                .setStyle(TextInputStyle.Paragraph)
                                .setRequired(true)
                                .setMaxLength(1500)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('clip_url')
                                .setLabel('Video / Clip URL (optional)')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(false)
                                .setMaxLength(400)
                        ),
                    );
                    return interaction.showModal(modal);
                }
                return;
            }

            // ── Modal submits ──────────────────────────────────────────────────
            if (interaction.isModalSubmit() && interaction.customId === 'ticket_general_modal') {
                await safeDefer(interaction, true);
                const reason = interaction.fields.getTextInputValue('reason');
                const ticketChannel = await createTicket(interaction, client, reason);
                if (ticketChannel) {
                    return safeReply(interaction, { content: `Your ticket has been opened: ${ticketChannel}` });
                }
                return safeReply(interaction, { content: 'Could not open your ticket. Please contact an administrator.' });
            }

            if (interaction.isModalSubmit() && interaction.customId === 'ticket_report_modal') {
                await safeDefer(interaction, true);

                const rawUser    = interaction.fields.getTextInputValue('reported_user').trim();
                const description = interaction.fields.getTextInputValue('description');
                const clipUrl     = interaction.fields.getTextInputValue('clip_url') || null;

                const reportedUserId = extractUserId(rawUser);
                if (!reportedUserId) {
                    return safeReply(interaction, {
                        content: 'I could not parse that user. Please provide a mention (e.g. `@Someone`) or a raw Discord user ID.',
                    });
                }

                const ticketChannel = await createStaffReportTicket(interaction, client, {
                    description,
                    reportedUserId,
                    evidenceFiles: null,
                    clipUrl,
                });
                if (ticketChannel) {
                    return safeReply(interaction, { content: `Your report has been filed: ${ticketChannel}` });
                }
                return safeReply(interaction, { content: 'Could not file your report. Please contact an administrator.' });
            }

            // ── Ticket buttons ─────────────────────────────────────────────────
            if (!interaction.isButton()) return;
            const customId = interaction.customId || '';

            if (customId.startsWith('ticket_claim:')) {
                return handleClaim(interaction, client);
            }
            if (customId.startsWith('ticket_unclaim:')) {
                return handleUnclaim(interaction, client);
            }
            if (customId.startsWith('ticket_close_force:')) {
                return handleForceClose(interaction, client);
            }
            if (customId.startsWith('ticket_close_accept:')) {
                return handleCloseAccept(interaction, client);
            }
            if (customId.startsWith('ticket_close_decline:')) {
                return handleCloseDecline(interaction, client);
            }
        } catch (err) {
            console.error('[TicketUI] Unhandled error:', err.message, err.stack);
            await safeReply(interaction, { content: 'Something went wrong handling that interaction.' });
        }
    },
};

// ── Handlers ──────────────────────────────────────────────────────────────────

function extractUserId(input) {
    if (!input) return null;
    const mentionMatch = input.match(/^<@!?(\d{15,25})>$/);
    if (mentionMatch) return mentionMatch[1];
    const idMatch = input.match(/^(\d{15,25})$/);
    if (idMatch) return idMatch[1];
    return null;
}

function isSupport(interaction, client) {
    const settings = client.settings.get(interaction.guild.id) || {};
    const supportRoleId = settings.ticketSupportRoleId;
    const hasRole = supportRoleId ? interaction.member?.roles?.cache?.has(supportRoleId) : false;
    const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
    return hasRole || isAdmin;
}

function buildRefreshedContainer(ticket, claimed, claimerMention) {
    const { hasBanner, hasFooter } = getTicketAttachments();
    return buildUpdatedContainer(ticket, claimed, claimerMention, { hasBanner, hasFooter });
}

async function handleClaim(interaction, client) {
    const ticket = getTicketData(client, interaction.channel.id);
    if (!ticket) return safeReply(interaction, { content: 'Ticket data missing for this channel.' });

    if (!isSupport(interaction, client)) {
        return safeReply(interaction, { content: 'Only support staff can claim tickets.' });
    }

    if (ticket.claimedBy) {
        return safeReply(interaction, { content: `This ticket is already claimed by <@${ticket.claimedBy}>.` });
    }

    setTicketData(client, interaction.channel.id, { claimedBy: interaction.user.id });

    const claimerMention = `<@${interaction.user.id}>`;
    const updated = { ...ticket, claimedBy: interaction.user.id };
    const container = buildRefreshedContainer(updated, true, claimerMention);

    try {
        await interaction.update({ components: [container] });
    } catch (e) {
        console.warn('[TicketUI] handleClaim update failed:', e.message);
    }
    return interaction.channel.send({
        content: `🔒 Ticket claimed by ${claimerMention}.`,
    });
}

async function handleUnclaim(interaction, client) {
    const ticket = getTicketData(client, interaction.channel.id);
    if (!ticket) return safeReply(interaction, { content: 'Ticket data missing for this channel.' });

    if (ticket.claimedBy !== interaction.user.id && !isSupport(interaction, client)) {
        return safeReply(interaction, { content: 'Only the claimer or a support staff member can unclaim this ticket.' });
    }

    setTicketData(client, interaction.channel.id, { claimedBy: null });

    const updated = { ...ticket, claimedBy: null };
    const container = buildRefreshedContainer(updated, false, null);

    try {
        await interaction.update({ components: [container] });
    } catch (e) {
        console.warn('[TicketUI] handleUnclaim update failed:', e.message);
    }
    return interaction.channel.send({
        content: `🔓 Ticket unclaimed by <@${interaction.user.id}>. It is now open for another staff member to claim.`,
    });
}

async function handleForceClose(interaction, client) {
    const ticket = getTicketData(client, interaction.channel.id);
    if (!ticket) return safeReply(interaction, { content: 'Ticket data missing for this channel.' });

    if (!isSupport(interaction, client) && ticket.claimedBy !== interaction.user.id) {
        return safeReply(interaction, { content: 'Only support staff or the ticket claimer can close this ticket.' });
    }

    await safeReply(interaction, { content: 'Closing ticket — sending transcript and deleting channel in a moment…' });

    try {
        await closeTicket(interaction.channel, ticket, interaction.user, client);
    } catch (err) {
        console.error('[TicketUI] Force close failed:', err.message);
    }
}

async function handleCloseAccept(interaction, client) {
    const ticket = getTicketData(client, interaction.channel.id);
    if (!ticket) return safeReply(interaction, { content: 'Ticket data missing for this channel.' });

    if (interaction.user.id !== ticket.creatorId) {
        return safeReply(interaction, { content: 'Only the ticket creator can accept the close request.' });
    }

    try {
        await interaction.update({
            content: `✅ Close request accepted by <@${interaction.user.id}>. Closing now…`,
            embeds: [],
            components: [],
        });
    } catch {}

    try {
        await closeTicket(interaction.channel, ticket, interaction.user, client);
    } catch (err) {
        console.error('[TicketUI] Close-accept failed:', err.message);
    }
}

async function handleCloseDecline(interaction, client) {
    const ticket = getTicketData(client, interaction.channel.id);
    if (!ticket) return safeReply(interaction, { content: 'Ticket data missing for this channel.' });

    if (interaction.user.id !== ticket.creatorId) {
        return safeReply(interaction, { content: 'Only the ticket creator can decline the close request.' });
    }

    try {
        await interaction.update({
            content: `❌ Close request declined by <@${interaction.user.id}>.`,
            embeds: [],
            components: [],
        });
    } catch {}
}
