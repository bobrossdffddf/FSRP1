const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    ChannelType,
} = require('discord.js');

const { setTicketData, nextTicketNumber } = require('../utils/ticketManager');
const { getMemberByDiscordId } = require('../api/melonly');

const BANNER_URL = 'https://i.postimg.cc/59HmqpCR/INFormation.png';
const LOGO_URL   = 'https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp';
const FOOTER_URL = 'https://i.postimg.cc/ZRqRj6bf/Untitled-design-(18).webp';

// ── Embed builders ────────────────────────────────────────────────────────────

function buildTicketEmbeds(creator, robloxInfo, reason) {
    const bannerEmbed = new EmbedBuilder()
        .setImage(BANNER_URL);

    const mainEmbed = new EmbedBuilder()
        .setColor(0x4B5EFC)
        .setTitle('General Support')
        .setThumbnail(LOGO_URL);

    // Roblox Information block
    if (robloxInfo) {
        const rId      = robloxInfo.robloxId ?? robloxInfo.roblox_id ?? robloxInfo.id ?? '—';
        const rUser    = robloxInfo.robloxUsername ?? robloxInfo.roblox_username ?? robloxInfo.username ?? '—';
        const rDisplay = robloxInfo.displayName ?? robloxInfo.display_name ?? rUser;
        const rCreated = robloxInfo.robloxCreated ?? robloxInfo.roblox_created_at ?? robloxInfo.accountCreated ?? null;

        let createdStr = '—';
        if (rCreated) {
            const d   = new Date(typeof rCreated === 'number' ? rCreated * 1000 : rCreated);
            const rel = formatRelative(d);
            createdStr = `${d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} (${rel})`;
        }

        mainEmbed.addFields({
            name: 'Roblox Information:',
            value:
                `**Username:** ${rUser} (${rId})\n` +
                `**Display Name:** ${rDisplay}\n` +
                `**Created:** ${createdStr}`,
            inline: false,
        });
    } else {
        mainEmbed.addFields({
            name: 'Roblox Information:',
            value: '*Not found — account may not be linked to Melonly.*',
            inline: false,
        });
    }

    mainEmbed.setDescription(
        `\u200b\nHi, ${creator}! Thank you for contacting the **Florida State Roleplay** Staff Team. ` +
        `We are always happy to assist you with your ticket. Our staff team is here to help with ` +
        `any questions or concerns you may have. To ensure you receive the best assistance, please ` +
        `provide additional details regarding your ticket.\n\u200b`
    );

    mainEmbed.setImage(FOOTER_URL);

    const reasonEmbed = new EmbedBuilder()
        .setColor(0x4B5EFC)
        .setTitle('Ticket Reason')
        .setDescription(reason || 'No reason provided.');

    return [bannerEmbed, mainEmbed, reasonEmbed];
}

function buildStaffRow(channelId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ticket_claim:${channelId}`)
            .setLabel('Claim')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`ticket_close_force:${channelId}`)
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger),
    );
}

function buildClaimedRow(channelId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ticket_unclaim:${channelId}`)
            .setLabel('Unclaim')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`ticket_close_force:${channelId}`)
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger),
    );
}

function buildClaimedBanner(claimer) {
    return new EmbedBuilder()
        .setColor(0x57F287)
        .setDescription(`This ticket has been claimed by ${claimer}. They will assist you shortly.`);
}

// ── Create Ticket ─────────────────────────────────────────────────────────────

async function createTicket(interaction, client, reason) {
    const guild    = interaction.guild;
    const creator  = interaction.member;
    const settings = client.settings.get(guild.id) || {};

    const categoryId    = settings.ticketCategoryId;
    const supportRoleId = settings.ticketSupportRoleId;

    const ticketNum  = nextTicketNumber(client, guild.id);
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
            reason: `Ticket #${ticketNum} opened by ${creator.user.username}`,
        });
    } catch (err) {
        console.error('[Ticket] Failed to create channel:', err.message);
        return null;
    }

    setTicketData(client, ticketChannel.id, {
        channelId:       ticketChannel.id,
        guildId:         guild.id,
        creatorId:       creator.id,
        claimedBy:       null,
        reason:          reason,
        openedAt:        Date.now(),
        ticketNumber:    ticketNum,
        escalationLevel: null,
    });

    // Fetch Roblox info from Melonly
    let robloxInfo = null;
    try {
        const melonlyData = await getMemberByDiscordId(creator.id);
        if (melonlyData) {
            // Log full object in dev to verify field names
            console.log(`[Ticket] Melonly data keys for ${creator.user.username}:`, Object.keys(melonlyData));
            robloxInfo = melonlyData;
        }
    } catch (err) {
        console.warn('[Ticket] Melonly lookup failed:', err.message);
    }

    const embeds   = buildTicketEmbeds(creator, robloxInfo, reason);
    const staffRow = buildStaffRow(ticketChannel.id);
    const mention  = supportRoleId ? `${creator} <@&${supportRoleId}>` : `${creator}`;

    try {
        await ticketChannel.send({
            content: mention,
            embeds:  embeds,
            components: [staffRow],
        });
    } catch (err) {
        console.error('[Ticket] Failed to send welcome embed:', err.message);
    }

    return ticketChannel;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    buildClaimedRow,
    buildClaimedBanner,
    buildStaffRow,
};
