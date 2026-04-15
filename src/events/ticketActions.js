const {
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SectionBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    ThumbnailBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    ChannelType,
    MessageFlags,
} = require('discord.js');

const { setTicketData, nextTicketNumber } = require('../utils/ticketManager');
const { getRobloxConnection }             = require('../api/melonly');
const { getRobloxUser, getRobloxHeadshot } = require('../api/roblox');

const BANNER_URL  = 'https://i.postimg.cc/59HmqpCR/INFormation.png';
const LOGO_URL    = 'https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp';
const ACCENT      = 0x4B5EFC;
const CV2_FLAG    = MessageFlags.IsComponentsV2;

// Server emoji IDs
const EMOJI_STAFF   = { id: '1491568422205526118', name: 'staff' };
const EMOJI_WARNING = { id: '1489218432850464768', name: 'warning' };
const EMOJI_PIN     = { id: '1491123495810367651', name: 'pin' };

// ── Container builders ────────────────────────────────────────────────────────

function buildTicketContainer(opts) {
    const {
        creatorMention,
        robloxText,
        thumbnailUrl,
        welcomeText,
        reason,
        channelId,
        claimed,          // false = unclaimed, true = claimed
        claimerMention,
    } = opts;

    const robloxSection = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## General Support\n**Roblox Information:**\n${robloxText}`
            )
        )
        .setThumbnailAccessory(
            new ThumbnailBuilder().setURL(thumbnailUrl).setDescription('Roblox')
        );

    const buttons = claimed
        ? new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ticket_close_force:${channelId}`)
                .setLabel('Close')
                .setStyle(ButtonStyle.Danger)
                .setEmoji(EMOJI_WARNING),
            new ButtonBuilder()
                .setCustomId(`ticket_unclaim:${channelId}`)
                .setLabel('Unclaim')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(EMOJI_PIN),
        )
        : new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ticket_claim:${channelId}`)
                .setLabel('Claim')
                .setStyle(ButtonStyle.Success)
                .setEmoji(EMOJI_STAFF),
            new ButtonBuilder()
                .setCustomId(`ticket_close_force:${channelId}`)
                .setLabel('Close')
                .setStyle(ButtonStyle.Danger)
                .setEmoji(EMOJI_WARNING),
        );

    const container = new ContainerBuilder()
        .setAccentColor(ACCENT)
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems([
                new MediaGalleryItemBuilder().setURL(BANNER_URL),
            ])
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1))
        .addSectionComponents(robloxSection)
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(welcomeText)
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`**Ticket Reason**\n${reason}`)
        );

    if (claimed && claimerMention) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# Claimed by ${claimerMention}`)
        );
    }

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
    container.addActionRowComponents(buttons);

    return container;
}

// ── Create Ticket ─────────────────────────────────────────────────────────────

async function createTicket(interaction, client, reason) {
    const guild    = interaction.guild;
    const creator  = interaction.member;
    const settings = client.settings.get(guild.id) || {};

    const categoryId    = settings.ticketCategoryId;
    const supportRoleId = settings.ticketSupportRoleId;

    const ticketNum   = nextTicketNumber(client, guild.id);
    const channelName = `ticket-${String(ticketNum).padStart(4, '0')}`;

    const permOverwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
            id: creator.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
            ],
        },
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
            topic: `Ticket #${ticketNum} | ${creator.user.username} | ${reason}`,
            reason: `Ticket #${ticketNum} by ${creator.user.username}`,
        });
    } catch (err) {
        console.error('[Ticket] Failed to create channel:', err.message);
        return null;
    }

    // ── Fetch Roblox info ─────────────────────────────────────────────────────
    let robloxText   = '*Not found — account may not be linked to Melonly.*';
    let thumbnailUrl = LOGO_URL;
    let robloxIdStr  = null;

    try {
        const verification = await getRobloxConnection(creator.id);
        console.log('[Ticket] Verification response:', verification);

        if (verification?.robloxId) {
            robloxIdStr = verification.robloxId;

            // Try to get headshot from Melonly response
            const headshotUrl = verification.headShotImage?.imageUrl
                ?? verification.headShotImage?.url
                ?? null;

            const [robloxUser, headshot] = await Promise.all([
                getRobloxUser(robloxIdStr),
                headshotUrl ? Promise.resolve(headshotUrl) : getRobloxHeadshot(robloxIdStr),
            ]);

            if (headshot) thumbnailUrl = headshot;

            if (robloxUser) {
                const created = robloxUser.created
                    ? formatDate(new Date(robloxUser.created))
                    : '—';

                robloxText =
                    `**Username:** ${robloxUser.name} (${robloxIdStr})\n` +
                    `**Display Name:** ${robloxUser.displayName}\n` +
                    `**Created:** ${created}`;
            } else {
                robloxText =
                    `**Roblox ID:** ${robloxIdStr}\n` +
                    `**Username:** *Could not retrieve — Roblox API unavailable*`;
            }
        }
    } catch (err) {
        console.warn('[Ticket] Roblox lookup failed:', err.message);
    }

    const welcomeText =
        `Hi, ${creator}! Thank you for contacting the **Florida State Roleplay** Staff Team. ` +
        `We are always happy to assist you with your ticket. Our staff team is here to help with ` +
        `any questions or concerns you may have. To ensure you receive the best assistance, please ` +
        `provide additional details regarding your ticket.`;

    setTicketData(client, ticketChannel.id, {
        channelId:       ticketChannel.id,
        guildId:         guild.id,
        creatorId:       creator.id,
        claimedBy:       null,
        reason:          reason,
        openedAt:        Date.now(),
        ticketNumber:    ticketNum,
        escalationLevel: null,
        // Stored for container rebuilds
        robloxText,
        thumbnailUrl,
        welcomeText,
    });

    const container = buildTicketContainer({
        creatorMention: `${creator}`,
        robloxText,
        thumbnailUrl,
        welcomeText,
        reason,
        channelId:      ticketChannel.id,
        claimed:        false,
    });

    const ping = supportRoleId
        ? `${creator} <@&${supportRoleId}>`
        : `${creator}`;

    try {
        const sent = await ticketChannel.send({
            content:    ping,
            components: [container],
            flags:      CV2_FLAG,
        });

        setTicketData(client, ticketChannel.id, { ticketMessageId: sent.id });
    } catch (err) {
        console.error('[Ticket] Failed to send welcome message:', err.message, err.stack);
    }

    return ticketChannel;
}

// ── Rebuild for claim / unclaim ───────────────────────────────────────────────

function buildUpdatedContainer(ticket, claimed, claimerMention) {
    return buildTicketContainer({
        creatorMention: `<@${ticket.creatorId}>`,
        robloxText:     ticket.robloxText     || '*No roblox info stored.*',
        thumbnailUrl:   ticket.thumbnailUrl   || LOGO_URL,
        welcomeText:    ticket.welcomeText    || '',
        reason:         ticket.reason         || 'No reason provided.',
        channelId:      ticket.channelId,
        claimed,
        claimerMention,
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(date) {
    const rel = formatRelative(date);
    return `${date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} (${rel})`;
}

function formatRelative(date) {
    const diff   = Date.now() - date.getTime();
    const days   = Math.floor(diff / 86400000);
    const years  = Math.floor(days / 365);
    const months = Math.floor(days / 30);
    if (years  >= 1) return `${years} year${years  !== 1 ? 's' : ''} ago`;
    if (months >= 1) return `${months} month${months !== 1 ? 's' : ''} ago`;
    return `${days} day${days !== 1 ? 's' : ''} ago`;
}

module.exports = {
    createTicket,
    buildUpdatedContainer,
    CV2_FLAG,
};
