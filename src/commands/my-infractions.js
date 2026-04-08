const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
} = require('discord.js');

const HR_ROLE_ID  = '1487127238058180810';
const LOGO_URL    = 'https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp';
const FOOTER_URL  = 'https://i.postimg.cc/ZRqRj6bf/Untitled-design-(18).webp';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('my-infractions')
        .setDescription('View your own infraction history.')
        .addUserOption(opt =>
            opt
                .setName('member')
                .setDescription('(HR only) Look up another member\'s infractions.')
                .setRequired(false)),

    async execute(interaction, client) {
        await interaction.deferReply({ flags: 64 });

        const isHR    = interaction.member?.roles?.cache?.has(HR_ROLE_ID);
        const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);

        const targetOption = interaction.options.getMember('member');

        // Only HR/admins can look up other members
        if (targetOption && targetOption.id !== interaction.user.id && !isHR && !isAdmin) {
            return interaction.editReply({ content: 'You can only view your own infractions.' });
        }

        const target     = targetOption || interaction.member;
        const userId     = target?.id || target?.user?.id;
        const displayName = target?.displayName || target?.user?.username || 'Unknown';
        const avatarURL  = (target?.user || target)?.displayAvatarURL?.({ dynamic: true });

        if (!userId) {
            return interaction.editReply({ content: 'Could not resolve that member.' });
        }

        const infractions = client.settings.get(`user_infractions_${userId}`) || [];
        const active = infractions.filter(i => i.active !== false);

        const activeWarnings = active.filter(i => i.punishment === 'Warning').length;
        const activeStrikes  = active.filter(i => i.punishment === 'Strike').length;
        const totalActive    = active.length;

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setThumbnail(LOGO_URL)
            .setAuthor({ name: displayName, iconURL: avatarURL })
            .setTitle('<:warning:1489218432850464768> Infraction History')
            .setDescription(`Infraction history for <@${userId}> | **${displayName}**`);

        embed.addFields(
            {
                name: '<:pin:1491123495810367651> Overview',
                value: [
                    `**Active Warnings:** ${activeWarnings}`,
                    `**Active Strikes:** ${activeStrikes}`,
                    `**Total Active Cases:** ${totalActive}`,
                ].join('\n'),
                inline: false,
            },
        );

        if (infractions.length > 0) {
            const recent = infractions.slice(-5).reverse();
            const lines = recent.map(inf => {
                const when   = inf.timestamp ? `<t:${inf.timestamp}:d>` : 'Unknown date';
                const status = inf.active !== false ? '🔴 Active' : '✅ Resolved';
                return `\`${inf.id}\` — **${inf.punishment}** — ${when} — ${status}\n> \`${inf.reason?.slice(0, 80) || 'No reason'}\``;
            }).join('\n');

            embed.addFields({
                name: `<:staff:1491568514216235179> Recent Infractions (${infractions.length} total)`,
                value: lines.slice(0, 1024),
                inline: false,
            });
        } else {
            embed.addFields({
                name: '<:staff:1491568514216235179> Recent Infractions',
                value: 'No infractions on record.',
                inline: false,
            });
        }

        embed
            .setImage(FOOTER_URL)
            .setFooter({ text: `Requested by ${interaction.user.username}` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};
