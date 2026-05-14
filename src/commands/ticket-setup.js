const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ChannelType,
} = require('discord.js');
const { buildTicketPanelContainer, buildTicketPanelFiles, TICKET_FLAGS } = require('../utils/ticketPanel');

/**
 * /ticket-setup — focused, one-shot configuration command for the ticket system.
 *
 * Writes the same enmap keys that the existing ticket code already reads
 * (ticketCategoryId, ticketSupportRoleId, ticketTranscriptChannelId,
 * ticketPanelChannelId, iaCategoryId) so this is fully backward-compatible
 * with /setup — admins can use either.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket-setup')
        .setDescription('(Admin) Configure the ticket system in one go.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub
                .setName('configure')
                .setDescription('Configure ticket categories, roles, channels — and post the panel automatically.')
                .addChannelOption(opt =>
                    opt.setName('category')
                        .setDescription('Category where new tickets are created.')
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(true))
                .addRoleOption(opt =>
                    opt.setName('support_role')
                        .setDescription('Role that can view and claim tickets.')
                        .setRequired(true))
                .addChannelOption(opt =>
                    opt.setName('log_channel')
                        .setDescription('Channel where closed-ticket transcripts are posted.')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true))
                .addChannelOption(opt =>
                    opt.setName('panel_channel')
                        .setDescription('Channel where the ticket-open panel will be posted.')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true))
                .addChannelOption(opt =>
                    opt.setName('ia_category')
                        .setDescription('Optional: separate category for Internal Affairs tickets.')
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(false))
        )
        .addSubcommand(sub =>
            sub
                .setName('verify')
                .setDescription('Check that the bot has the permissions it needs in the configured ticket category.')
        ),

    async execute(interaction, client) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'Only server administrators can use `/ticket-setup`.', flags: 64 });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'verify') return runVerify(interaction, client);
        if (sub === 'configure') return runConfigure(interaction, client);
    },
};

async function runConfigure(interaction, client) {
    await interaction.deferReply({ flags: 64 });

    const category     = interaction.options.getChannel('category');
    const supportRole  = interaction.options.getRole('support_role');
    const logChannel   = interaction.options.getChannel('log_channel');
    const panelChannel = interaction.options.getChannel('panel_channel');
    const iaCategory   = interaction.options.getChannel('ia_category');

    const guildId  = interaction.guild.id;
    const existing = client.settings.get(guildId) || {};

    const updates = {
        ticketCategoryId:           category.id,
        ticketSupportRoleId:        supportRole.id,
        ticketTranscriptChannelId:  logChannel.id,
        ticketPanelChannelId:       panelChannel.id,
    };
    if (iaCategory) updates.iaCategoryId = iaCategory.id;

    client.settings.set(guildId, { ...existing, ...updates });

    // ── Post the ticket panel automatically ──────────────────────────────────
    let panelPostStatus = '✅ Posted to the panel channel.';
    try {
        const sent = await panelChannel.send({
            components: [buildTicketPanelContainer()],
            files: buildTicketPanelFiles(),
            flags: TICKET_FLAGS,
        });
        client.settings.set(guildId, {
            ...client.settings.get(guildId),
            ticketPanelMessageId: sent.id,
        });
    } catch (err) {
        console.error('[TicketSetup] Failed to post panel:', err.message);
        panelPostStatus = `⚠️ Could not post panel — \`${err.message}\`. Check that I can send messages in ${panelChannel}.`;
    }

    // ── Permission preflight in the ticket category ──────────────────────────
    const me        = interaction.guild.members.me;
    const catPerms  = category.permissionsFor(me);
    const required  = [
        ['ViewChannel',        PermissionFlagsBits.ViewChannel],
        ['ManageChannels',     PermissionFlagsBits.ManageChannels],
        ['ManageRoles',        PermissionFlagsBits.ManageRoles],
        ['SendMessages',       PermissionFlagsBits.SendMessages],
        ['EmbedLinks',         PermissionFlagsBits.EmbedLinks],
        ['AttachFiles',        PermissionFlagsBits.AttachFiles],
        ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory],
    ];
    const missing = required.filter(([, bit]) => !catPerms?.has(bit)).map(([name]) => name);

    const embed = new EmbedBuilder()
        .setTitle('✅ Ticket System Configured')
        .setColor(missing.length === 0 ? 0x57F287 : 0xFEE75C)
        .addFields(
            { name: 'Ticket Category',     value: `${category}`,    inline: true },
            { name: 'Support Role',        value: `${supportRole}`, inline: true },
            { name: 'Transcript Channel',  value: `${logChannel}`,  inline: true },
            { name: 'Panel Channel',       value: `${panelChannel}`, inline: true },
            { name: 'IA Category',         value: iaCategory ? `${iaCategory}` : '*(none — uses main category)*', inline: true },
            { name: 'Panel',               value: panelPostStatus,  inline: false },
        )
        .setFooter({ text: `Updated by ${interaction.user.username}` })
        .setTimestamp();

    if (missing.length > 0) {
        embed.addFields({
            name: '⚠️ Missing Bot Permissions in Ticket Category',
            value:
                `The bot is missing these permissions on ${category}: **${missing.join(', ')}**\n` +
                `Tickets may fail to open or close until these are granted. ` +
                `Fix in **Server Settings → Channels → ${category.name} → Permissions**, ` +
                `then run \`/ticket-setup verify\` to recheck.`,
            inline: false,
        });
    }

    return interaction.editReply({ embeds: [embed] });
}

async function runVerify(interaction, client) {
    await interaction.deferReply({ flags: 64 });

    const settings = client.settings.get(interaction.guild.id) || {};
    const issues = [];

    // Required settings present?
    if (!settings.ticketCategoryId)          issues.push('Ticket category not configured.');
    if (!settings.ticketSupportRoleId)       issues.push('Support role not configured.');
    if (!settings.ticketTranscriptChannelId) issues.push('Transcript channel not configured.');
    if (!settings.ticketPanelChannelId)      issues.push('Panel channel not configured.');

    const category        = settings.ticketCategoryId
        ? interaction.guild.channels.cache.get(settings.ticketCategoryId)
        : null;
    const supportRole     = settings.ticketSupportRoleId
        ? interaction.guild.roles.cache.get(settings.ticketSupportRoleId)
        : null;
    const transcriptCh    = settings.ticketTranscriptChannelId
        ? interaction.guild.channels.cache.get(settings.ticketTranscriptChannelId)
        : null;
    const panelCh         = settings.ticketPanelChannelId
        ? interaction.guild.channels.cache.get(settings.ticketPanelChannelId)
        : null;

    if (settings.ticketCategoryId && !category)            issues.push(`Ticket category \`${settings.ticketCategoryId}\` no longer exists.`);
    if (settings.ticketSupportRoleId && !supportRole)      issues.push(`Support role \`${settings.ticketSupportRoleId}\` no longer exists.`);
    if (settings.ticketTranscriptChannelId && !transcriptCh) issues.push(`Transcript channel \`${settings.ticketTranscriptChannelId}\` no longer exists.`);
    if (settings.ticketPanelChannelId && !panelCh)         issues.push(`Panel channel \`${settings.ticketPanelChannelId}\` no longer exists.`);

    const me = interaction.guild.members.me;
    if (category) {
        const catPerms = category.permissionsFor(me);
        const required = [
            ['ViewChannel',        PermissionFlagsBits.ViewChannel],
            ['ManageChannels',     PermissionFlagsBits.ManageChannels],
            ['ManageRoles',        PermissionFlagsBits.ManageRoles],
            ['SendMessages',       PermissionFlagsBits.SendMessages],
            ['EmbedLinks',         PermissionFlagsBits.EmbedLinks],
            ['AttachFiles',        PermissionFlagsBits.AttachFiles],
            ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory],
        ];
        for (const [name, bit] of required) {
            if (!catPerms?.has(bit)) issues.push(`Bot missing **${name}** on ticket category ${category}.`);
        }
    }

    if (transcriptCh) {
        const p = transcriptCh.permissionsFor(me);
        if (!p?.has(PermissionFlagsBits.SendMessages)) issues.push(`Bot cannot **SendMessages** in transcript channel ${transcriptCh}.`);
        if (!p?.has(PermissionFlagsBits.AttachFiles))  issues.push(`Bot cannot **AttachFiles** in transcript channel ${transcriptCh}.`);
        if (!p?.has(PermissionFlagsBits.EmbedLinks))   issues.push(`Bot cannot **EmbedLinks** in transcript channel ${transcriptCh}.`);
    }

    const embed = new EmbedBuilder()
        .setTitle(issues.length === 0 ? '✅ Ticket System OK' : '⚠️ Ticket System Issues')
        .setColor(issues.length === 0 ? 0x57F287 : 0xED4245)
        .addFields(
            { name: 'Ticket Category',    value: category     ? `${category}`     : '*(not set)*', inline: true },
            { name: 'Support Role',       value: supportRole  ? `${supportRole}`  : '*(not set)*', inline: true },
            { name: 'Transcript Channel', value: transcriptCh ? `${transcriptCh}` : '*(not set)*', inline: true },
            { name: 'Panel Channel',      value: panelCh      ? `${panelCh}`      : '*(not set)*', inline: true },
            { name: 'IA Category',        value: settings.iaCategoryId
                ? `<#${settings.iaCategoryId}>` : '*(none — uses main category)*', inline: true },
        )
        .setTimestamp();

    if (issues.length > 0) {
        embed.addFields({ name: 'Issues', value: issues.map(i => `• ${i}`).join('\n').slice(0, 1024), inline: false });
    } else {
        embed.setDescription('All required settings present and the bot has all needed permissions.');
    }

    return interaction.editReply({ embeds: [embed] });
}
