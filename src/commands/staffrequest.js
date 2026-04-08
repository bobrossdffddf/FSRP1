const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
} = require('discord.js');
const { getServerInfo } = require('../api/erlc');

const STAFF_ROLE_ID = '1487127237898666070';
const HR_ROLE_ID = '1487127238058180810';

const LOGO_URL = 'https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp';
const FOOTER_URL = 'https://i.postimg.cc/ZRqRj6bf/Untitled-design-(18).webp';
const ERLC_GAME_URL = 'https://www.roblox.com/games/2534724415';

// Map<messageId, { respondees: Set<userId>, channelId: string, guildId: string, serverMax: number }>
const activeRequests = new Map();

function buildRequestEmbed(playerCount, maxPlayers, respondees) {
    const respondeeList = respondees.size > 0
        ? [...respondees].map(id => `• <@${id}>`).join('\n')
        : '*No respondees yet.*';

    return new EmbedBuilder()
        .setTitle('Game Assistance')
        .setColor('#5865F2')
        .setThumbnail(LOGO_URL)
        .setDescription(
            'We are in-need of in-game staff members to assist players with assistance, and to ensure that our server is maintained with a great roleplay experience.'
        )
        .addFields(
            { name: '\u200b', value: `Players In-game: **${playerCount}/${maxPlayers}**`, inline: false },
            { name: 'Respondees:', value: respondeeList, inline: false },
        )
        .setImage(FOOTER_URL)
        .setTimestamp();
}

function buildRequestRow(joinUrl) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('staffrequest_respond')
            .setLabel('Respond')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setLabel('Join In-Game')
            .setStyle(ButtonStyle.Link)
            .setURL(joinUrl || ERLC_GAME_URL),
    );
    return row;
}

module.exports = {
    activeRequests,

    data: new SlashCommandBuilder()
        .setName('staffrequest')
        .setDescription('Send a game assistance request pinging the staff team.')
        .setDefaultMemberPermissions(0n),

    async execute(interaction, client) {
        const isStaff = interaction.member?.roles?.cache?.has(STAFF_ROLE_ID);
        const isHR = interaction.member?.roles?.cache?.has(HR_ROLE_ID);
        const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);

        if (!isStaff && !isHR && !isAdmin) {
            return interaction.reply({
                content: 'You do not have permission to send a staff request. (Staff Team role required)',
                flags: 64,
            });
        }

        await interaction.deferReply({ flags: 64 });

        const guildSettings = client.settings.get(interaction.guild.id) || {};
        const targetChannel = guildSettings.staffRequestChannelId
            ? client.channels.cache.get(guildSettings.staffRequestChannelId)
            : interaction.channel;

        if (!targetChannel) {
            return interaction.editReply({ content: 'Staff request channel not found. Configure it with `/setup`.' });
        }

        let playerCount = '?';
        let maxPlayers = 40;
        let joinUrl = ERLC_GAME_URL;

        try {
            const serverInfo = await getServerInfo();
            if (serverInfo) {
                playerCount = serverInfo.CurrentPlayers ?? '?';
                maxPlayers = serverInfo.MaxPlayers ?? 40;
                if (serverInfo.JoinKey) {
                    joinUrl = `https://policeroleplay.community/join/${serverInfo.JoinKey}`;
                }
            }
        } catch (e) {
            console.warn('[StaffRequest] Could not fetch server info:', e.message);
        }

        const respondees = new Set();
        const embed = buildRequestEmbed(playerCount, maxPlayers, respondees);
        const row = buildRequestRow(joinUrl);

        try {
            const sent = await targetChannel.send({
                content: `<@&${STAFF_ROLE_ID}>`,
                embeds: [embed],
                components: [row],
            });

            activeRequests.set(sent.id, {
                respondees,
                channelId: targetChannel.id,
                guildId: interaction.guild.id,
                playerCount,
                maxPlayers,
                joinUrl,
            });

            await interaction.editReply({ content: 'Staff request sent!' });
        } catch (e) {
            console.error('[StaffRequest] Failed to send:', e.message);
            await interaction.editReply({ content: 'Failed to send the staff request. Check channel permissions.' });
        }
    },
};
