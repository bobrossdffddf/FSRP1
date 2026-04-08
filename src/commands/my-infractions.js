const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
} = require('discord.js');

const MANAGE_ROLE_ID = '1487127238028824690';
const HR_ROLE_ID     = '1487127238058180810';
const LOGO_URL       = 'https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp';
const FOOTER_URL     = 'https://i.postimg.cc/ZRqRj6bf/Untitled-design-(18).webp';

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

        const isHR    = interaction.member?.roles?.cache?.has(HR_ROLE_ID) ||
                        interaction.member?.roles?.cache?.has(MANAGE_ROLE_ID);
        const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);

        const targetOption = interaction.options.getMember('member');

        if (targetOption && targetOption.id !== interaction.user.id && !isHR && !isAdmin) {
            return interaction.editReply({ content: 'You can only view your own infractions.' });
        }

        const target      = targetOption || interaction.member;
        const userId      = target?.id ?? target?.user?.id;
        const displayName = target?.displayName ?? target?.user?.username ?? 'Unknown';
        const avatarURL   = (target?.user ?? target)?.displayAvatarURL?.({ dynamic: true });

        if (!userId) return interaction.editReply({ content: 'Could not resolve that member.' });

        const infractions = client.settings.get(`user_infractions_${userId}`) || [];
        const active      = infractions.filter(i => i.active !== false);
        const resolved    = infractions.filter(i => i.active === false);

        const warns   = active.filter(i => i.punishment === 'Warning').length;
        const strikes = active.filter(i => i.punishment === 'Strike').length;
        const other   = active.filter(i => !['Warning', 'Strike'].includes(i.punishment)).length;

        const statusColor = active.length === 0     ? 0x57F287
            : warns >= 2 || strikes >= 1            ? 0xED4245
            : 0xFEE75C;

        const embed = new EmbedBuilder()
            .setColor(statusColor)
            .setAuthor({ name: displayName, iconURL: avatarURL })
            .setThumbnail(LOGO_URL)
            .setTitle('<:warning:1489218432850464768>  Infraction History')
            .setDescription(`Infraction record for <@${userId}>`)
            .addFields(
                { name: 'Active',   value: `\`${active.length}\``,   inline: true },
                { name: 'Resolved', value: `\`${resolved.length}\``, inline: true },
                { name: 'Total',    value: `\`${infractions.length}\``, inline: true },
            );

        if (active.length > 0) {
            const parts = [];
            if (warns)   parts.push(`**${warns}** Warning${warns !== 1 ? 's' : ''}`);
            if (strikes) parts.push(`**${strikes}** Strike${strikes !== 1 ? 's' : ''}`);
            if (other)   parts.push(`**${other}** Other`);
            embed.addFields({
                name:   '<:pin:1491123495810367651>  Active Breakdown',
                value:  parts.join(' · '),
                inline: false,
            });
        }

        if (infractions.length > 0) {
            const recent = [...infractions].reverse().slice(0, 6);
            const lines  = recent.map(inf => {
                const when   = inf.timestamp ? `<t:${inf.timestamp}:d>` : '?';
                const badge  = inf.active !== false ? '`●`' : '`○`';
                const reason = (inf.reason || 'No reason').slice(0, 60);
                return `${badge} \`${inf.id}\` **${inf.punishment}** — ${when}\n> ${reason}`;
            }).join('\n');

            embed.addFields({
                name:   `<:staff:1491568514216235179>  Recent Cases (${infractions.length} total)`,
                value:  lines.slice(0, 1024),
                inline: false,
            });
        } else {
            embed.addFields({
                name:   '<:staff:1491568514216235179>  Cases',
                value:  'No infractions on record.',
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
