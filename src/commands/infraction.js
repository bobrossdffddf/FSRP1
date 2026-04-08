const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
} = require('discord.js');

const MANAGE_ROLE_ID = '1487127238028824690';
const HR_ROLE_ID     = '1487127238058180810';
const LOGO_URL       = 'https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp';
const FOOTER_URL     = 'https://i.postimg.cc/ZRqRj6bf/Untitled-design-(18).webp';

const PUNISHMENT_COLORS = {
    Warning:     '#FEE75C',
    Strike:      '#ED4245',
    Demotion:    '#FFA500',
    Termination: '#8B0000',
    Other:       '#5865F2',
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
    const next = current + 1;
    client.settings.set('__infraction_counter', next);
    return `INF-${String(next).padStart(6, '0')}`;
}

// Builds the manage embed + button rows for a given user
function buildManageEmbed(userId, displayName, avatarURL, infractions) {
    const active   = infractions.filter(i => i.active !== false);
    const resolved = infractions.filter(i => i.active === false);

    const activeWarnings = active.filter(i => i.punishment === 'Warning').length;
    const activeStrikes  = active.filter(i => i.punishment === 'Strike').length;
    const activeOther    = active.filter(i => !['Warning', 'Strike'].includes(i.punishment)).length;

    const embed = new EmbedBuilder()
        .setColor('#ED4245')
        .setAuthor({ name: displayName, iconURL: avatarURL })
        .setThumbnail(LOGO_URL)
        .setTitle('<:warning:1489218432850464768>  Infraction Manager')
        .setDescription(`Managing infractions for <@${userId}>`);

    embed.addFields({
        name: '<:pin:1491123495810367651>  Overview',
        value: [
            `**Active Warnings:** \`${activeWarnings}\``,
            `**Active Strikes:** \`${activeStrikes}\``,
            `**Other Active:** \`${activeOther}\``,
            `**Total Resolved:** \`${resolved.length}\``,
        ].join('\n'),
        inline: false,
    });

    if (infractions.length > 0) {
        const recent = [...infractions].reverse().slice(0, 8);
        const lines = recent.map(inf => {
            const when   = inf.timestamp ? `<t:${inf.timestamp}:d>` : '?';
            const status = inf.active !== false ? '`ACTIVE`' : '`RESOLVED`';
            const reason = (inf.reason || 'No reason').slice(0, 55);
            return `${status} \`${inf.id}\` — **${inf.punishment}** — ${when}\n> ${reason}`;
        }).join('\n');

        embed.addFields({
            name: `<:staff:1491568514216235179>  Case History (${infractions.length} total)`,
            value: lines.slice(0, 1024),
            inline: false,
        });
    } else {
        embed.addFields({
            name: '<:staff:1491568514216235179>  Case History',
            value: 'No infractions on record.',
            inline: false,
        });
    }

    embed
        .setImage(FOOTER_URL)
        .setTimestamp();

    // Build resolve buttons for up to 5 active infractions
    const components = [];
    const activeList = active.slice(0, 5);

    if (activeList.length > 0) {
        // Max 5 buttons per row — split into rows of 5
        for (let i = 0; i < activeList.length; i += 5) {
            const row = new ActionRowBuilder();
            const chunk = activeList.slice(i, i + 5);
            for (const inf of chunk) {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`inf_resolve:${inf.id}:${userId}`)
                        .setLabel(`Resolve ${inf.id}`)
                        .setStyle(ButtonStyle.Danger),
                );
            }
            components.push(row);
        }
    }

    return { embed, components };
}

module.exports = {
    MANAGE_ROLE_ID,

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

    buildManageEmbed,

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
            const color         = PUNISHMENT_COLORS[punishment] || '#ED4245';
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
                .setTitle('<:warning:1489218432850464768>  Staff Infraction')
                .addFields(
                    {
                        name:   '<:staff:1491568422205526118>  Staff Member',
                        value:  `${member} — \`${member.user.username}\``,
                        inline: false,
                    },
                    {
                        name:   '<:warning:1489218432850464768>  Punishment',
                        value:  `\`${punishment}\``,
                        inline: true,
                    },
                    {
                        name:   '<:pin:1491123495810367651>  Case ID',
                        value:  `\`${infractionId}\``,
                        inline: true,
                    },
                    {
                        name:   '<:staff:1491568514216235179>  Reason',
                        value:  `\`\`\`${reason}\`\`\``,
                        inline: false,
                    },
                    {
                        name:   '\u200b',
                        value:  `> This punishment is not subject to change. <@&${HR_ROLE_ID}> will review any concerns raised in a ticket.`,
                        inline: false,
                    },
                )
                .setImage(FOOTER_URL)
                .setFooter({ text: `Issued by ${interaction.user.username} • ${infractionId}` })
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
                console.log(`[Infraction] Stored ${infractionId} for user ${member.id} (${member.user.username})`);
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
            const displayName = target?.displayName || target?.user?.username || 'Unknown';
            const avatarURL   = target?.user?.displayAvatarURL({ dynamic: true });

            if (!userId) return interaction.editReply({ content: 'Could not resolve that member.' });

            const infractions = client.settings.get(`user_infractions_${userId}`) || [];
            const { embed, components } = buildManageEmbed(userId, displayName, avatarURL, infractions);

            embed.setFooter({ text: `Managed by ${interaction.user.username}` });

            await interaction.editReply({ embeds: [embed], components });
        }
    },
};
