/**
 * Ticket Actions — core logic for creating and managing tickets.
 * This file has no `name` export, so the event loader skips it (it's a helper).
 */

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    ChannelType,
} = require('discord.js');

const { setTicketData, nextTicketNumber, getTicketData } = require('../utils/ticketManager');
const { getMemberByDiscordId } = require('../api/melonly');

// ── Ticket Channel Embed & Controls ──────────────────────────────────────────

function buildWelcomeEmbed(creator, robloxInfo, reason) {
    const embed = new EmbedBuilder()
        .setColor(0x1A1F6E)
        .setTitle('🎫  Support Ticket Opened')
        .setDescription(
            `Hey ${creator}! A member of our staff team will be with you shortly.\n` +
            `Please describe your issue in as much detail as possible.\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        )
        .setThumbnail(creator.displayAvatarURL({ dynamic: true }))
        .setTimestamp()
        .setFooter({ text: 'Support Desk  •  Do not ping staff — they will be with you soon.' });

    // ── Roblox info from Melonly ──────────────────────────────────────────────
    if (robloxInfo) {
        const rId      = robloxInfo.robloxId ?? robloxInfo.id ?? '—';
        const rUser    = robloxInfo.robloxUsername ?? robloxInfo.username ?? '—';
        const rDisplay = robloxInfo.displayName ?? robloxInfo.robloxDisplayName ?? rUser;
        const rCreated = robloxInfo.robloxCreated ?? robloxInfo.created ?? null;

        let createdStr = '—';
        if (rCreated) {
            const d = new Date(rCreated);
            const relative = formatRelative(d);
            createdStr = `${d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} *(${relative})*`;
        }

        embed.addFields(
            {
                name: '🎮 Roblox Profile',
                value:
                    `> **Username:** \`${rUser}\` *(ID: ${rId})*\n` +
                    `> **Display Name:** ${rDisplay}\n` +
                    `> **Account Created:** ${createdStr}`,
                inline: false,
            }
        );
    } else {
        embed.addFields({
            name: '🎮 Roblox Profile',
            value: '> *Could not retrieve Roblox information — account may not be linked.*',
            inline: false,
        });
    }

    embed.addFields(
        { name: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', value: '\u200b', inline: false },
        { name: '📋 Ticket Reason', value: `> ${reason || 'No reason provided'}`, inline: false },
    );

    return embed;
}

function buildStaffRow(channelId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ticket_claim:${channelId}`)
            .setLabel('Claim Ticket')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✋'),
        new ButtonBuilder()
            .setCustomId(`ticket_close_force:${channelId}`)
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔒'),
    );
}

function buildClaimedRow(channelId, claimerTag) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ticket_unclaim:${channelId}`)
            .setLabel('Unclaim')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('↩️'),
        new ButtonBuilder()
            .setCustomId(`ticket_close_force:${channelId}`)
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔒'),
    );
}

function buildClaimedBanner(claimer) {
    return new EmbedBuilder()
        .setColor(0x57F287)
        .setDescription(`✅  This ticket has been claimed by ${claimer}. They will assist you shortly.`);
}

// ── Create Ticket ─────────────────────────────────────────────────────────────

async function createTicket(interaction, client, reason) {
    const guild    = interaction.guild;
    const creator  = interaction.member;
    const settings = client.settings.get(guild.id) || {};

    const categoryId      = settings.ticketCategoryId;
    const supportRoleId   = settings.ticketSupportRoleId;

    const ticketNum = nextTicketNumber(client, guild.id);
    const channelName = `ticket-${String(ticketNum).padStart(4, '0')}`;

    // Build permission overwrites
    const permOverwrites = [
        // Deny everyone by default
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        // Allow the creator
        {
            id: creator.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
            ],
        },
        // Allow the bot
        {
            id: client.user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.AttachFiles,
            ],
        },
    ];

    if (supportRoleId) {
        permOverwrites.push({
            id: supportRoleId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.ManageMessages,
            ],
        });
    }

    let ticketChannel;
    try {
        ticketChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: categoryId || null,
            permissionOverwrites: permOverwrites,
            topic: `Ticket #${ticketNum} | Opened by ${creator.user.username} | Reason: ${reason}`,
            reason: `Ticket opened by ${creator.user.username}`,
        });
    } catch (err) {
        console.error('[Ticket] Failed to create channel:', err.message);
        return null;
    }

    // Save ticket data
    setTicketData(client, ticketChannel.id, {
        channelId:     ticketChannel.id,
        guildId:       guild.id,
        creatorId:     creator.id,
        claimedBy:     null,
        reason:        reason,
        openedAt:      Date.now(),
        ticketNumber:  ticketNum,
        escalationLevel: null,
    });

    // Fetch Roblox info from Melonly
    let robloxInfo = null;
    try {
        const melonlyData = await getMemberByDiscordId(creator.id);
        if (melonlyData) {
            robloxInfo = melonlyData.member ?? melonlyData;
        }
    } catch (err) {
        console.warn('[Ticket] Melonly lookup failed:', err.message);
    }

    // Send welcome embed
    const welcomeEmbed = buildWelcomeEmbed(creator, robloxInfo, reason);
    const staffRow     = buildStaffRow(ticketChannel.id);

    try {
        await ticketChannel.send({
            content: `${creator} ${supportRoleId ? `<@&${supportRoleId}>` : ''}`.trim(),
            embeds: [welcomeEmbed],
            components: [staffRow],
        });
    } catch (err) {
        console.error('[Ticket] Failed to send welcome embed:', err.message);
    }

    return ticketChannel;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelative(date) {
    const now   = Date.now();
    const diff  = now - date.getTime();
    const days  = Math.floor(diff / 86400000);
    const years = Math.floor(days / 365);
    if (years >= 1) return `${years} year${years !== 1 ? 's' : ''} ago`;
    const months = Math.floor(days / 30);
    if (months >= 1) return `${months} month${months !== 1 ? 's' : ''} ago`;
    return `${days} day${days !== 1 ? 's' : ''} ago`;
}

module.exports = {
    createTicket,
    buildClaimedRow,
    buildClaimedBanner,
    buildStaffRow,
};
