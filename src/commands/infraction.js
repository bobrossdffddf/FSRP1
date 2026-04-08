const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
} = require('discord.js');

const HR_ROLE_ID = '1487127238058180810';

const LOGO_URL = 'https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp';
const FOOTER_URL = 'https://i.postimg.cc/ZRqRj6bf/Untitled-design-(18).webp';

const PUNISHMENT_COLORS = {
    Warning: '#FEE75C',
    Strike: '#ED4245',
    Demotion: '#FFA500',
    Termination: '#8B0000',
    Other: '#5865F2',
};

function getNextInfractionId(client) {
    const current = client.settings.get('__infraction_counter') || 0;
    const next = current + 1;
    client.settings.set('__infraction_counter', next);
    return `INF-${String(next).padStart(6, '0')}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('infraction')
        .setDescription('Issue a staff infraction. (HR only)')
        .setDefaultMemberPermissions(0n)
        .addUserOption(option =>
            option
                .setName('member')
                .setDescription('The staff member receiving the infraction.')
                .setRequired(true))
        .addStringOption(option =>
            option
                .setName('punishment')
                .setDescription('Type of punishment.')
                .setRequired(true)
                .addChoices(
                    { name: 'Warning', value: 'Warning' },
                    { name: 'Strike', value: 'Strike' },
                    { name: 'Demotion', value: 'Demotion' },
                    { name: 'Termination', value: 'Termination' },
                    { name: 'Other', value: 'Other' },
                ))
        .addStringOption(option =>
            option
                .setName('reason')
                .setDescription('Reason for the infraction.')
                .setRequired(true)
                .setMaxLength(1000)),

    async execute(interaction, client) {
        const isHR = interaction.member?.roles?.cache?.has(HR_ROLE_ID);
        const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);

        if (!isHR && !isAdmin) {
            return interaction.reply({
                content: 'You do not have permission to issue infractions. (HR role required)',
                flags: 64,
            });
        }

        await interaction.deferReply({ flags: 64 });

        const member = interaction.options.getMember('member');
        const punishment = interaction.options.getString('punishment');
        const reason = interaction.options.getString('reason');

        if (!member) {
            return interaction.editReply({ content: 'That user was not found in this server.' });
        }

        const infractionId = getNextInfractionId(client);
        const color = PUNISHMENT_COLORS[punishment] || '#ED4245';

        const guildSettings = client.settings.get(interaction.guild.id) || {};
        const targetChannel = guildSettings.infractionChannelId
            ? client.channels.cache.get(guildSettings.infractionChannelId)
            : interaction.channel;

        if (!targetChannel) {
            return interaction.editReply({ content: 'Infraction channel not found. Configure it with `/setup`.' });
        }

        const embed = new EmbedBuilder()
            .setTitle('Staff Infraction')
            .setColor(color)
            .setThumbnail(LOGO_URL)
            .addFields(
                { name: '<:staff:1491568422205526118> Staff Member', value: `${member}`, inline: false },
                { name: '<:warning:1489218432850464768> Punishment', value: `\`${punishment}\``, inline: false },
                { name: '\u200b', value: '\u200b', inline: false },
                { name: '<:pin:1491123495810367651> Reason', value: `\`\`\`${reason}\`\`\``, inline: false },
                {
                    name: '\u200b',
                    value: `This punishment is not subject to change. <@&${HR_ROLE_ID}> will read your concern in a ticket.`,
                    inline: false,
                },
            )
            .setImage(FOOTER_URL)
            .setFooter({
                text: `${member.user.username} • Punishment ID: ${infractionId}`,
                iconURL: member.user.displayAvatarURL({ dynamic: true }),
            })
            .setTimestamp();

        try {
            await targetChannel.send({ content: `${member}`, embeds: [embed] });
            await interaction.editReply({ content: `Infraction issued to ${member.user.username} — **${infractionId}**` });

            // Persist infraction record per user for /my-infractions
            const userInfractions = client.settings.get(`user_infractions_${member.id}`) || [];
            userInfractions.push({
                id: infractionId,
                punishment,
                reason,
                issuedBy: interaction.user.id,
                timestamp: Math.floor(Date.now() / 1000),
                active: true,
            });
            client.settings.set(`user_infractions_${member.id}`, userInfractions);
            console.log(`[Infraction] Stored ${infractionId} for user ${member.id} (${member.user.username})`);
        } catch (e) {
            console.error('[Infraction] Failed to send:', e.message);
            await interaction.editReply({ content: 'Failed to send the infraction. Check channel permissions.' });
        }
    },
};
