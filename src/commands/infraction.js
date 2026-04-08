const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    PermissionFlagsBits,
} = require('discord.js');

const MANAGE_ROLE_ID = '1487127238028824690';
const HR_ROLE_ID     = '1487127238058180810';
const LOGO_URL       = 'https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp';
const FOOTER_URL     = 'https://i.postimg.cc/ZRqRj6bf/Untitled-design-(18).webp';

const PUNISHMENT_COLORS = {
    Warning:     0xFEE75C,
    Strike:      0xED4245,
    Demotion:    0xFFA500,
    Termination: 0x8B0000,
    Other:       0x5865F2,
};

const PUNISHMENT_EMOJI = {
    Warning:     '<:warning:1489218432850464768>',
    Strike:      '<:warning:1489218432850464768>',
    Demotion:    '<:staff:1491568514216235179>',
    Termination: '<:staff:1491568514216235179>',
    Other:       '<:pin:1491123495810367651>',
};

function hasAccess(member) {
    if (!member) return false;
    return (
        member.roles.cache.has(MANAGE_ROLE_ID) ||
        member.roles.cache.has(HR_ROLE_ID) ||
        member.permissions.has(PermissionFlagsBits.Administrator)
    );
}

function getNextInfractionId(client) {
    const current = client.settings.get('__infraction_counter') || 0;
    const next    = current + 1;
    client.settings.set('__infraction_counter', next);
    return `INF-${String(next).padStart(6, '0')}`;
}

// ── Stage 1: List / overview embed ───────────────────────────────────────────
function buildListEmbed(userId, displayName, avatarURL, infractions) {
    const active   = infractions.filter(i => i.active !== false);
    const resolved = infractions.filter(i => i.active === false);
    const warns    = active.filter(i => i.punishment === 'Warning').length;
    const strikes  = active.filter(i => i.punishment === 'Strike').length;
    const other    = active.filter(i => !['Warning', 'Strike'].includes(i.punishment)).length;

    // Summary bar
    const summaryParts = [];
    if (warns)    summaryParts.push(`**${warns}** Warning${warns !== 1 ? 's' : ''}`);
    if (strikes)  summaryParts.push(`**${strikes}** Strike${strikes !== 1 ? 's' : ''}`);
    if (other)    summaryParts.push(`**${other}** Other`);
    const summaryLine = summaryParts.length > 0 ? summaryParts.join(' · ') : 'No active cases';

    const embed = new EmbedBuilder()
        .setColor(active.length > 0 ? 0xED4245 : 0x57F287)
        .setAuthor({ name: displayName, iconURL: avatarURL })
        .setThumbnail(LOGO_URL)
        .setTitle('<:warning:1489218432850464768>  Infraction Manager')
        .setDescription(`Managing cases for <@${userId}>`)
        .addFields(
            {
                name: 'Active',
                value: `\`${active.length}\``,
                inline: true,
            },
            {
                name: 'Resolved',
                value: `\`${resolved.length}\``,
                inline: true,
            },
            {
                name: 'Total',
                value: `\`${infractions.length}\``,
                inline: true,
            },
            {
                name: '<:pin:1491123495810367651>  Summary',
                value: summaryLine,
                inline: false,
            },
        );

    // Case table
    if (infractions.length > 0) {
        const rows = [...infractions].reverse().slice(0, 10).map(inf => {
            const date   = inf.timestamp ? `<t:${inf.timestamp}:d>` : '?';
            const status = inf.active !== false ? '`●`' : '`○`';
            return `${status} \`${inf.id}\` **${inf.punishment}** — ${date}`;
        }).join('\n');

        embed.addFields({
            name: `<:staff:1491568514216235179>  Cases (${infractions.length} total) — select one below to manage`,
            value: rows.slice(0, 1024),
            inline: false,
        });
    } else {
        embed.addFields({
            name: '<:staff:1491568514216235179>  Cases',
            value: 'No infractions on record.',
            inline: false,
        });
    }

    embed.setImage(FOOTER_URL).setTimestamp();

    // Select menu — up to 25 cases
    const components = [];
    if (infractions.length > 0) {
        const options = [...infractions].reverse().slice(0, 25).map(inf => {
            const label   = `${inf.id} — ${inf.punishment}`;
            const desc    = (inf.reason || 'No reason').slice(0, 50);
            const isActive = inf.active !== false;
            return new StringSelectMenuOptionBuilder()
                .setLabel(label)
                .setValue(inf.id)
                .setDescription(desc)
                .setEmoji(isActive ? { name: 'warning', id: '1489218432850464768' } : { name: 'pin', id: '1491123495810367651' });
        });

        const menu = new StringSelectMenuBuilder()
            .setCustomId(`inf_select:${userId}`)
            .setPlaceholder('Select a case to manage...')
            .addOptions(options);

        components.push(new ActionRowBuilder().addComponents(menu));
    }

    return { embed, components };
}

// ── Stage 2: Case detail embed ────────────────────────────────────────────────
function buildCaseEmbed(inf, userId, displayName, avatarURL) {
    const color    = PUNISHMENT_COLORS[inf.punishment] ?? 0x5865F2;
    const emoji    = PUNISHMENT_EMOJI[inf.punishment] ?? '<:pin:1491123495810367651>';
    const isActive = inf.active !== false;
    const date     = inf.timestamp ? `<t:${inf.timestamp}:f>` : 'Unknown';
    const resolvedAt = inf.resolvedAt ? `<t:${inf.resolvedAt}:f>` : null;

    const embed = new EmbedBuilder()
        .setColor(isActive ? color : 0x57F287)
        .setAuthor({ name: `${displayName} — ${inf.id}`, iconURL: avatarURL })
        .setThumbnail(LOGO_URL)
        .setTitle(`${emoji}  Case Detail`)
        .addFields(
            {
                name: 'Punishment',
                value: `\`${inf.punishment}\``,
                inline: true,
            },
            {
                name: 'Status',
                value: isActive ? '`ACTIVE`' : '`RESOLVED`',
                inline: true,
            },
            {
                name: 'Issued',
                value: date,
                inline: true,
            },
            {
                name: '<:staff:1491568422205526118>  Issued By',
                value: inf.issuedBy ? `<@${inf.issuedBy}>` : 'Unknown',
                inline: true,
            },
            ...(resolvedAt ? [
                {
                    name: '<:staff:1491568514216235179>  Resolved By',
                    value: inf.resolvedBy ? `<@${inf.resolvedBy}>` : 'Unknown',
                    inline: true,
                },
                {
                    name: 'Resolved At',
                    value: resolvedAt,
                    inline: true,
                },
            ] : []),
            {
                name: '<:pin:1491123495810367651>  Reason',
                value: `\`\`\`${(inf.reason || 'No reason provided').slice(0, 900)}\`\`\``,
                inline: false,
            },
        )
        .setImage(FOOTER_URL)
        .setTimestamp();

    // Buttons row
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`inf_back:${userId}`)
            .setLabel('← Back')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`inf_edit:${inf.id}:${userId}`)
            .setLabel('Edit')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!isActive),
        new ButtonBuilder()
            .setCustomId(`inf_resolve:${inf.id}:${userId}`)
            .setLabel(isActive ? 'Resolve' : 'Resolved')
            .setStyle(isActive ? ButtonStyle.Danger : ButtonStyle.Secondary)
            .setDisabled(!isActive),
    );

    return { embed, components: [row] };
}

module.exports = {
    MANAGE_ROLE_ID,
    buildListEmbed,
    buildCaseEmbed,

    data: new SlashCommandBuilder()
        .setName('infraction')
        .setDescription('Staff infraction tools.')
        .setDefaultMemberPermissions(0n)
        .addSubcommand(sub =>
            sub
                .setName('issue')
                .setDescription('Issue a staff infraction.')
                .addUserOption(opt =>
                    opt.setName('member')
                        .setDescription('The staff member receiving the infraction.')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('punishment')
                        .setDescription('Type of punishment.')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Warning',     value: 'Warning'     },
                            { name: 'Strike',      value: 'Strike'      },
                            { name: 'Demotion',    value: 'Demotion'    },
                            { name: 'Termination', value: 'Termination' },
                            { name: 'Other',       value: 'Other'       },
                        ))
                .addStringOption(opt =>
                    opt.setName('reason')
                        .setDescription('Reason for the infraction.')
                        .setRequired(true)
                        .setMaxLength(1000)))
        .addSubcommand(sub =>
            sub
                .setName('manage')
                .setDescription('View and manage infractions for a member.')
                .addUserOption(opt =>
                    opt.setName('member')
                        .setDescription('The member to manage infractions for.')
                        .setRequired(true))),

    async execute(interaction, client) {
        if (!hasAccess(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', flags: 64 });
        }

        const sub = interaction.options.getSubcommand();

        // ── /infraction issue ──────────────────────────────────────────────────
        if (sub === 'issue') {
            await interaction.deferReply({ flags: 64 });

            const member     = interaction.options.getMember('member');
            const punishment = interaction.options.getString('punishment');
            const reason     = interaction.options.getString('reason');

            if (!member) return interaction.editReply({ content: 'That user was not found in this server.' });

            const infractionId  = getNextInfractionId(client);
            const color         = PUNISHMENT_COLORS[punishment] ?? 0xED4245;
            const guildSettings = client.settings.get(interaction.guild.id) || {};
            const targetChannel = guildSettings.infractionChannelId
                ? client.channels.cache.get(guildSettings.infractionChannelId)
                : interaction.channel;

            if (!targetChannel) {
                return interaction.editReply({ content: 'Infraction channel not found. Configure it with `/setup`.' });
            }

            const embed = new EmbedBuilder()
                .setColor(color)
                .setAuthor({
                    name:    member.user.username,
                    iconURL: member.user.displayAvatarURL({ dynamic: true }),
                })
                .setThumbnail(LOGO_URL)
                .setTitle(`${PUNISHMENT_EMOJI[punishment] ?? '<:warning:1489218432850464768>'}  Staff Infraction`)
                .addFields(
                    {
                        name:   '<:staff:1491568422205526118>  Staff Member',
                        value:  `${member} — \`${member.user.username}\``,
                        inline: false,
                    },
                    {
                        name:   'Punishment',
                        value:  `\`${punishment}\``,
                        inline: true,
                    },
                    {
                        name:   'Case ID',
                        value:  `\`${infractionId}\``,
                        inline: true,
                    },
                    {
                        name:   'Issued By',
                        value:  `${interaction.user}`,
                        inline: true,
                    },
                    {
                        name:   '<:pin:1491123495810367651>  Reason',
                        value:  `\`\`\`${reason}\`\`\``,
                        inline: false,
                    },
                    {
                        name:   '\u200b',
                        value:  `> This punishment is not subject to change. <@&${HR_ROLE_ID}> reviews concerns in a ticket.`,
                        inline: false,
                    },
                )
                .setImage(FOOTER_URL)
                .setFooter({ text: `${infractionId} • Issued by ${interaction.user.username}` })
                .setTimestamp();

            try {
                await targetChannel.send({ content: `${member}`, embeds: [embed] });
                await interaction.editReply({
                    content: `Infraction issued to **${member.user.username}** — \`${infractionId}\``,
                });

                const userInfractions = client.settings.get(`user_infractions_${member.id}`) || [];
                userInfractions.push({
                    id:        infractionId,
                    punishment,
                    reason,
                    issuedBy:  interaction.user.id,
                    timestamp: Math.floor(Date.now() / 1000),
                    active:    true,
                });
                client.settings.set(`user_infractions_${member.id}`, userInfractions);
                console.log(`[Infraction] Stored ${infractionId} for ${member.user.username} (${member.id})`);
            } catch (e) {
                console.error('[Infraction] Failed to send:', e.message);
                await interaction.editReply({ content: 'Failed to send the infraction. Check channel permissions.' });
            }
        }

        // ── /infraction manage ─────────────────────────────────────────────────
        if (sub === 'manage') {
            if (!interaction.member.roles.cache.has(MANAGE_ROLE_ID) &&
                !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: 'You need the manage role to use this subcommand.', flags: 64 });
            }

            await interaction.deferReply({ flags: 64 });

            const target      = interaction.options.getMember('member');
            const userId      = target?.id;
            const displayName = target?.displayName ?? target?.user?.username ?? 'Unknown';
            const avatarURL   = target?.user?.displayAvatarURL({ dynamic: true });

            if (!userId) return interaction.editReply({ content: 'Could not resolve that member.' });

            const infractions = client.settings.get(`user_infractions_${userId}`) || [];
            const { embed, components } = buildListEmbed(userId, displayName, avatarURL, infractions);
            embed.setFooter({ text: `Opened by ${interaction.user.username}` });

            await interaction.editReply({ embeds: [embed], components });
        }
    },
};
