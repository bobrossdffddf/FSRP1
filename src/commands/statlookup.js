const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
} = require('discord.js');
const { getMemberByDiscordId, getLogsForStaff, getShiftsForMember, getAuditLogs } = require('../api/melonly');

const MANAGE_ROLE_ID = '1487127238028824690';
const LOGO_URL       = 'https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp';
const FOOTER_URL     = 'https://i.postimg.cc/ZRqRj6bf/Untitled-design-(18).webp';

const LOG_TYPE_LABELS = {
    1: 'Warning',
    2: 'Strike',
    3: 'Demotion',
    4: 'Promotion',
    5: 'Termination',
    6: 'Blacklist',
    7: 'Note',
    8: 'BOLO',
};

function fmtDate(ts) {
    return ts ? `<t:${ts}:d>` : '?';
}

function fmtDuration(startTs, endTs) {
    if (!startTs) return 'Unknown';
    if (!endTs || endTs === 0) return 'Ongoing';
    const totalMin = Math.floor(((endTs - startTs) * 1000) / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function hasAccess(member) {
    if (!member) return false;
    return (
        member.roles.cache.has(MANAGE_ROLE_ID) ||
        member.permissions.has(PermissionFlagsBits.Administrator)
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('statlookup')
        .setDescription('View detailed staff stats, logs, shifts and recent commands for a member.')
        .setDefaultMemberPermissions(0n)
        .addUserOption(opt =>
            opt.setName('member')
                .setDescription('The Discord member to look up.')
                .setRequired(true)),

    async execute(interaction, client) {
        if (!hasAccess(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', flags: 64 });
        }

        await interaction.deferReply({ flags: 64 });

        const target      = interaction.options.getMember('member') ?? interaction.options.getUser('member');
        const discordId   = target?.id ?? target?.user?.id;
        const displayName = target?.displayName ?? target?.user?.username ?? 'Unknown';
        const avatarURL   = (target?.user ?? target)?.displayAvatarURL?.({ dynamic: true });

        if (!discordId) return interaction.editReply({ content: 'Could not resolve that member.' });

        // Local infractions (stored by this bot)
        const localInfractions = client.settings.get(`user_infractions_${discordId}`) || [];
        const localActive      = localInfractions.filter(i => i.active !== false);

        // Melonly data
        const melonlyMember = await getMemberByDiscordId(discordId);

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setAuthor({ name: displayName, iconURL: avatarURL })
            .setThumbnail(LOGO_URL)
            .setTitle(`<:staff:1491568422205526118>  Staff Lookup — ${displayName}`);

        // ── Local infraction summary ───────────────────────────────────────────
        const localWarn   = localActive.filter(i => i.punishment === 'Warning').length;
        const localStrike = localActive.filter(i => i.punishment === 'Strike').length;

        embed.addFields({
            name: '<:warning:1489218432850464768>  Bot Infractions',
            value: [
                `**Active Warnings:** \`${localWarn}\``,
                `**Active Strikes:** \`${localStrike}\``,
                `**Total Active:** \`${localActive.length}\`  |  **Total All-Time:** \`${localInfractions.length}\``,
            ].join('\n'),
            inline: false,
        });

        // ── Melonly section ────────────────────────────────────────────────────
        if (!melonlyMember) {
            embed.addFields({
                name: '<:pin:1491123495810367651>  Melonly',
                value: '```Not found in Melonly — they may not be registered.```',
                inline: false,
            });
            embed.setImage(FOOTER_URL).setFooter({ text: `Requested by ${interaction.user.username} • FSRP` }).setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        const melonlyId = melonlyMember.id;

        const [logsResp, shiftsResp, auditResp] = await Promise.all([
            getLogsForStaff(melonlyId, 1, 10),
            getShiftsForMember(melonlyId, 1, 10),
            getAuditLogs(1, 50),
        ]);

        const logs   = logsResp?.data   || [];
        const shifts = shiftsResp?.data || [];

        const allAudit = auditResp?.data || [];
        const myAudit  = allAudit.filter(e => {
            const eid = e.memberId || e.member?.id || e.executorId || e.staffId;
            return eid === melonlyId || eid === discordId;
        });

        // Melonly Profile
        const roles = melonlyMember.roles?.length > 0
            ? melonlyMember.roles.slice(0, 4).map(r => `\`${r}\``).join(', ')
            : '`None`';

        embed.addFields({
            name: '<:pin:1491123495810367651>  Melonly Profile',
            value: [
                `**ID:** \`${melonlyId}\``,
                `**Registered:** ${melonlyMember.createdAt ? `<t:${melonlyMember.createdAt}:D>` : 'Unknown'}`,
                `**Roles:** ${roles}`,
            ].join('\n'),
            inline: false,
        });

        // Melonly Logs
        if (logs.length > 0) {
            const lines = logs.slice(0, 5).map(log => {
                const type = LOG_TYPE_LABELS[log.type] ?? `Type ${log.type}`;
                const date = fmtDate(log.createdAt);
                const text = (log.text || log.description || 'No description').slice(0, 65);
                return `\`${type}\` — ${date}\n\`\`\`${text}\`\`\``;
            }).join('\n');

            embed.addFields({
                name: `<:staff:1491568514216235179>  Melonly Logs (${logsResp?.total ?? logs.length} total)`,
                value: lines.slice(0, 1024),
                inline: false,
            });
        } else {
            embed.addFields({
                name: '<:staff:1491568514216235179>  Melonly Logs',
                value: '```No logs found.```',
                inline: false,
            });
        }

        // Shifts
        if (shifts.length > 0) {
            const lines = shifts.slice(0, 5).map((s, i) => {
                const type     = s.type || 'Standard';
                const date     = fmtDate(s.createdAt);
                const duration = fmtDuration(s.createdAt, s.endedAt);
                const status   = (!s.endedAt || s.endedAt === 0) ? ' `ACTIVE`' : '';
                return `\`${String(i + 1).padStart(2, '0')}\` **${type}** — ${date} — \`${duration}\`${status}`;
            }).join('\n');

            embed.addFields({
                name: `<:pin:1491123495810367651>  Shifts (${shiftsResp?.total ?? shifts.length} total)`,
                value: lines.slice(0, 1024),
                inline: false,
            });
        } else {
            embed.addFields({
                name: '<:pin:1491123495810367651>  Shifts',
                value: '```No shifts found.```',
                inline: false,
            });
        }

        // Recent commands from audit log
        if (myAudit.length > 0) {
            const lines = myAudit.slice(0, 5).map(e => {
                const action = e.action || e.type || 'Unknown';
                const date   = fmtDate(e.createdAt);
                const tgt    = e.targetName || e.target || '';
                return `\`${action}\`${tgt ? ` → \`${tgt}\`` : ''} — ${date}`;
            }).join('\n');

            embed.addFields({
                name: `<:staff:1491568422205526118>  Recent Commands (${myAudit.length} found)`,
                value: lines.slice(0, 1024),
                inline: false,
            });
        } else {
            embed.addFields({
                name: '<:staff:1491568422205526118>  Recent Commands',
                value: '```No recent commands in audit log.```',
                inline: false,
            });
        }

        embed
            .setImage(FOOTER_URL)
            .setFooter({ text: `Requested by ${interaction.user.username} • FSRP` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};
