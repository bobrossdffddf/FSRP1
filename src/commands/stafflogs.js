const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
} = require('discord.js');
const { getMemberByDiscordId, getLogsForStaff, getShiftsForMember } = require('../api/melonly');

const HR_ROLE_ID = '1487127238058180810';
const LOGO_URL = 'https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp';
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

function formatTs(ts) {
    if (!ts) return 'Unknown';
    return `<t:${ts}:f>`;
}

function formatDuration(startTs, endTs) {
    if (!startTs || !endTs) return 'Ongoing';
    const ms = (endTs - startTs) * 1000;
    const totalMin = Math.floor(ms / 60000);
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
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
        const isHR = interaction.member?.roles?.cache?.has(HR_ROLE_ID);
        const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);

        if (!isHR && !isAdmin) {
            return interaction.reply({
                content: 'You do not have permission to use this command. (HR role required)',
                flags: 64,
            });
        }

        await interaction.deferReply({ flags: 64 });

        const target = interaction.options.getMember('member') || interaction.options.getUser('member');
        const discordId = target?.id || target?.user?.id;
        const displayName = target?.displayName || target?.user?.username || 'Unknown';
        const avatarURL = (target?.user || target)?.displayAvatarURL?.({ dynamic: true });

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

        const logs = logsResp?.data || [];
        const shifts = shiftsResp?.data || [];

        const embed = new EmbedBuilder()
            .setTitle(`Staff Record — ${displayName}`)
            .setColor('#5865F2')
            .setThumbnail(LOGO_URL)
            .setAuthor({ name: displayName, iconURL: avatarURL })
            .addFields(
                {
                    name: 'Melonly ID',
                    value: `\`${melonlyId}\``,
                    inline: true,
                },
                {
                    name: 'Registered',
                    value: melonlyMember.createdAt ? formatTs(melonlyMember.createdAt) : 'Unknown',
                    inline: true,
                },
                {
                    name: 'Roles',
                    value: melonlyMember.roles?.length > 0
                        ? melonlyMember.roles.slice(0, 5).join(', ')
                        : 'None',
                    inline: false,
                },
            );

        if (logs.length > 0) {
            const logLines = logs.slice(0, 5).map(log => {
                const type = LOG_TYPES[log.type] || `Type ${log.type}`;
                const date = log.createdAt ? `<t:${log.createdAt}:d>` : '?';
                const text = log.text ? log.text.slice(0, 80) : log.description?.slice(0, 80) || 'No description';
                return `• **${type}** — ${date}\n  ${text}`;
            }).join('\n');

            embed.addFields({
                name: `📋 Recent Logs (${logsResp.total ?? logs.length} total)`,
                value: logLines.slice(0, 1024),
                inline: false,
            });
        } else {
            embed.addFields({ name: '📋 Logs', value: 'No logs found.', inline: false });
        }

        if (shifts.length > 0) {
            const shiftLines = shifts.slice(0, 5).map(shift => {
                const start = shift.createdAt ? `<t:${shift.createdAt}:d>` : '?';
                const duration = formatDuration(shift.createdAt, shift.endedAt);
                const type = shift.type || 'Standard';
                return `• **${type}** — ${start} (${duration})`;
            }).join('\n');

            embed.addFields({
                name: `🕐 Recent Shifts (${shiftsResp.total ?? shifts.length} total)`,
                value: shiftLines.slice(0, 1024),
                inline: false,
            });
        } else {
            embed.addFields({ name: '🕐 Shifts', value: 'No shifts found.', inline: false });
        }

        embed.setImage(FOOTER_URL).setFooter({ text: 'FSRP Staff Records' }).setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};
