const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
} = require('discord.js');
const { getMemberByDiscordId, getLogsForStaff, getShiftsForMember, getAuditLogs } = require('../api/melonly');

const HR_ROLE_ID  = '1487127238058180810';
const LOGO_URL    = 'https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp';
const FOOTER_URL  = 'https://i.postimg.cc/ZRqRj6bf/Untitled-design-(18).webp';

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
    if (!startTs) return 'Unknown';
    if (!endTs) return '🟢 Ongoing';
    const ms       = (endTs - startTs) * 1000;
    const totalMin = Math.floor(ms / 60000);
    const hours    = Math.floor(totalMin / 60);
    const mins     = totalMin % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('statlookup')
        .setDescription('Look up detailed staff stats, shifts, logs and recent commands for a member.')
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

        const [logsResp, shiftsResp, auditResp] = await Promise.all([
            getLogsForStaff(melonlyId, 1, 10),
            getShiftsForMember(melonlyId, 1, 10),
            getAuditLogs(1, 50),
        ]);

        const logs   = logsResp?.data   || [];
        const shifts = shiftsResp?.data || [];

        // Filter audit logs to only show entries for this staff member
        const allAuditEntries = auditResp?.data || [];
        const memberAudit = allAuditEntries.filter(entry => {
            const entryMember = entry.memberId || entry.member?.id || entry.executorId;
            return entryMember === melonlyId || entryMember === discordId;
        });

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setThumbnail(LOGO_URL)
            .setAuthor({ name: displayName, iconURL: avatarURL })
            .setTitle(`<:staff:1491568422205526118> Staff Lookup — ${displayName}`);

        // Overview
        embed.addFields({
            name: '<:pin:1491123495810367651> Melonly Profile',
            value: [
                `**ID:** \`${melonlyId}\``,
                `**Registered:** ${melonlyMember.createdAt ? formatTs(melonlyMember.createdAt) : 'Unknown'}`,
                `**Roles:** ${melonlyMember.roles?.length > 0 ? melonlyMember.roles.slice(0, 4).join(', ') : 'None'}`,
            ].join('\n'),
            inline: false,
        });

        // Recent logs (infractions/notes/etc.)
        if (logs.length > 0) {
            const logLines = logs.slice(0, 5).map(log => {
                const type = LOG_TYPES[log.type] || `Type ${log.type}`;
                const date = log.createdAt ? `<t:${log.createdAt}:d>` : '?';
                const text = (log.text || log.description || 'No description').slice(0, 80);
                return `\`${type}\` — ${date}\n> \`${text}\``;
            }).join('\n');

            embed.addFields({
                name: `<:warning:1489218432850464768> Recent Logs (${logsResp?.total ?? logs.length} total)`,
                value: logLines.slice(0, 1024),
                inline: false,
            });
        } else {
            embed.addFields({
                name: '<:warning:1489218432850464768> Recent Logs',
                value: '```No logs found.```',
                inline: false,
            });
        }

        // Recent shifts
        if (shifts.length > 0) {
            const totalShifts = shiftsResp?.total ?? shifts.length;
            const shiftLines = shifts.slice(0, 5).map(shift => {
                const start    = shift.createdAt ? `<t:${shift.createdAt}:d>` : '?';
                const duration = formatDuration(shift.createdAt, shift.endedAt);
                const type     = shift.type || 'Standard';
                return `\`${type}\` — ${start} — ${duration}`;
            }).join('\n');

            embed.addFields({
                name: `🕐 Recent Shifts (${totalShifts} total)`,
                value: shiftLines.slice(0, 1024),
                inline: false,
            });
        } else {
            embed.addFields({
                name: '🕐 Recent Shifts',
                value: '```No shifts found.```',
                inline: false,
            });
        }

        // Recent commands (audit log)
        if (memberAudit.length > 0) {
            const cmdLines = memberAudit.slice(0, 5).map(entry => {
                const action = entry.action || entry.type || 'Unknown action';
                const date   = entry.createdAt ? `<t:${entry.createdAt}:d>` : '?';
                const target = entry.targetName || entry.target || '';
                return `\`${action}\`${target ? ` → \`${target}\`` : ''} — ${date}`;
            }).join('\n');

            embed.addFields({
                name: `<:staff:1491568514216235179> Recent Commands (${memberAudit.length} shown)`,
                value: cmdLines.slice(0, 1024),
                inline: false,
            });
        } else {
            embed.addFields({
                name: '<:staff:1491568514216235179> Recent Commands',
                value: '```No recent commands found in audit log.```',
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
