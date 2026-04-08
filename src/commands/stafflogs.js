const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
} = require('discord.js');
const { getMemberByDiscordId, getLogsForStaff, getShiftsForMember } = require('../api/melonly');

const HR_ROLE_ID = '1487127238058180810';
const LOGO_URL   = 'https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp';
const FOOTER_URL = 'https://i.postimg.cc/ZRqRj6bf/Untitled-design-(18).webp';

const LOG_TYPES = {
    1: 'Warning',
    2: 'Strike',
    3: 'Demotion',
    4: 'Promotion',
    5: 'Termination',
    6: 'Blacklist',
    7: 'Note',
    8: 'BOLO',
};

function fmtTs(ts) {
    if (!ts) return 'Unknown';
    return `<t:${ts}:f>`;
}

function fmtDuration(startTs, endTs) {
    if (!startTs) return 'Unknown';
    if (!endTs || endTs === 0) return '🟢 Ongoing';
    const totalMin = Math.floor(((endTs - startTs) * 1000) / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stafflogs')
        .setDescription('Look up Melonly logs and shifts for a staff member. (HR only)')
        .setDefaultMemberPermissions(0n)
        .addUserOption(opt =>
            opt
                .setName('member')
                .setDescription('The Discord member to look up.')
                .setRequired(true)),

    async execute(interaction, client) {
        const isHR    = interaction.member?.roles?.cache?.has(HR_ROLE_ID);
        const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);

        if (!isHR && !isAdmin) {
            return interaction.reply({
                content: 'You do not have permission to use this command. (HR role required)',
                flags: 64,
            });
        }

        await interaction.deferReply({ flags: 64 });

        const target      = interaction.options.getMember('member') || interaction.options.getUser('member');
        const discordId   = target?.id || target?.user?.id;
        const displayName = target?.displayName || target?.user?.username || 'Unknown';
        const avatarURL   = (target?.user || target)?.displayAvatarURL?.({ dynamic: true });

        if (!discordId) {
            return interaction.editReply({ content: 'Could not resolve that member.' });
        }

        const melonlyMember = await getMemberByDiscordId(discordId);
        if (!melonlyMember) {
            return interaction.editReply({
                content: `**${displayName}** was not found in the Melonly system. They may not be registered.`,
            });
        }

        const melonlyId = melonlyMember.id;

        const [logsResp, shiftsResp] = await Promise.all([
            getLogsForStaff(melonlyId, 1, 10),
            getShiftsForMember(melonlyId, 1, 10),
        ]);

        const logs   = logsResp?.data  || [];
        const shifts = shiftsResp?.data || [];

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setAuthor({ name: displayName, iconURL: avatarURL })
            .setThumbnail(LOGO_URL)
            .setTitle(`<:staff:1491568422205526118>  Staff Record — ${displayName}`);

        // Profile overview
        const roles = melonlyMember.roles?.length > 0
            ? melonlyMember.roles.slice(0, 5).map(r => `\`${r}\``).join(', ')
            : '`None`';

        embed.addFields({
            name: '<:pin:1491123495810367651>  Profile',
            value: [
                `**Melonly ID:** \`${melonlyId}\``,
                `**Registered:** ${melonlyMember.createdAt ? `<t:${melonlyMember.createdAt}:D>` : 'Unknown'}`,
                `**Roles:** ${roles}`,
            ].join('\n'),
            inline: false,
        });

        // Logs
        if (logs.length > 0) {
            const lines = logs.slice(0, 5).map(log => {
                const type = LOG_TYPES[log.type] || `Type ${log.type}`;
                const date = log.createdAt ? `<t:${log.createdAt}:d>` : '?';
                const text = (log.text || log.description || 'No description').slice(0, 70);
                return `\`${type}\` — ${date}\n> \`\`\`${text}\`\`\``;
            }).join('\n');

            embed.addFields({
                name: `<:warning:1489218432850464768>  Recent Logs (${logsResp.total ?? logs.length} total)`,
                value: lines.slice(0, 1024),
                inline: false,
            });
        } else {
            embed.addFields({
                name: '<:warning:1489218432850464768>  Recent Logs',
                value: '```No logs found.```',
                inline: false,
            });
        }

        // Shifts
        if (shifts.length > 0) {
            const lines = shifts.slice(0, 5).map((s, i) => {
                const date     = s.createdAt ? `<t:${s.createdAt}:d>` : '?';
                const duration = fmtDuration(s.createdAt, s.endedAt);
                const type     = s.type || 'Standard';
                return `\`${String(i + 1).padStart(2, '0')}\` **${type}** — ${date} — \`${duration}\``;
            }).join('\n');

            embed.addFields({
                name: `🕐  Recent Shifts (${shiftsResp.total ?? shifts.length} total)`,
                value: lines.slice(0, 1024),
                inline: false,
            });
        } else {
            embed.addFields({
                name: '🕐  Recent Shifts',
                value: '```No shifts found.```',
                inline: false,
            });
        }

        embed
            .setImage(FOOTER_URL)
            .setFooter({ text: `Requested by ${interaction.user.username} • FSRP Staff Records` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};
