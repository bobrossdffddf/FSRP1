const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ChannelType,
} = require('discord.js');

const { buildPriorityEmbed, buildPriorityRow } = require('../utils/priorityMessage');
const { buildTicketPanelContainer, TICKET_FLAGS } = require('../utils/ticketPanel');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('(Admin only) Configure this server\'s settings.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        // ── Existing options ──────────────────────────────────────────────────
        .addChannelOption(option =>
            option.setName('ssu_channel').setDescription('Channel where SSU/SSD session announcements are sent.').setRequired(false))
        .addRoleOption(option =>
            option.setName('ping_role').setDescription('Role to ping when an SSU vote is started.').setRequired(false))
        .addChannelOption(option =>
            option.setName('logs_channel').setDescription('Channel where general bot command logs are posted.').setRequired(false))
        .addChannelOption(option =>
            option.setName('priority_channel').setDescription('Channel where the permanent priority-request button is posted.').setRequired(false))
        .addChannelOption(option =>
            option.setName('infraction_channel').setDescription('Channel where staff infraction notices are posted.').setRequired(false))
        .addChannelOption(option =>
            option.setName('promotion_channel').setDescription('Channel where staff promotion announcements are posted.').setRequired(false))
        .addChannelOption(option =>
            option.setName('staffrequest_channel').setDescription('Channel where game assistance / staff requests are posted.').setRequired(false))
        .addChannelOption(option =>
            option.setName('shift_channel').setDescription('Channel where shift warnings and shoutouts are posted.').setRequired(false))
        .addChannelOption(option =>
            option.setName('flag_channel').setDescription('Channel where Shift Contribution Flags are sent. Defaults to shift channel if not set.').setRequired(false))
        .addRoleOption(option =>
            option.setName('flag_role_1').setDescription('First management role to ping when a Shift Contribution Flag is issued.').setRequired(false))
        .addRoleOption(option =>
            option.setName('flag_role_2').setDescription('Second management role to ping (e.g. Management Team).').setRequired(false))
        .addRoleOption(option =>
            option.setName('flag_role_3').setDescription('Third management role to ping (e.g. Ownership Team).').setRequired(false))
        // ── Ticket System options ─────────────────────────────────────────────
        .addChannelOption(option =>
            option.setName('ticket_panel_channel').setDescription('[Tickets] Channel where the ticket panel is posted.').setRequired(false))
        .addChannelOption(option =>
            option.setName('ticket_category').setDescription('[Tickets] Category where new tickets are created.').setRequired(false))
        .addRoleOption(option =>
            option.setName('ticket_support_role').setDescription('[Tickets] Role that can view and claim tickets.').setRequired(false))
        .addChannelOption(option =>
            option.setName('ticket_transcript_channel').setDescription('[Tickets] Channel where closed ticket transcripts are posted.').setRequired(false))
        .addChannelOption(option =>
            option.setName('management_category').setDescription('[Tickets] Category tickets are moved to on Management escalation.').setRequired(false))
        .addChannelOption(option =>
            option.setName('directorship_category').setDescription('[Tickets] Category tickets are moved to on Directorship escalation.').setRequired(false))
        .addChannelOption(option =>
            option.setName('ownership_category').setDescription('[Tickets] Category tickets are moved to on Ownership escalation.').setRequired(false)),

    async execute(interaction, client) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return safeReply(interaction, { content: 'Only server administrators can use `/setup`.', flags: 64 });
        }

        await interaction.deferReply({ flags: 64 }).catch(() => {});

        // ── Collect options ───────────────────────────────────────────────────
        const ssuChannel              = interaction.options.getChannel('ssu_channel');
        const pingRole                = interaction.options.getRole('ping_role');
        const logsChannel             = interaction.options.getChannel('logs_channel');
        const priorityChannel         = interaction.options.getChannel('priority_channel');
        const infractionChannel       = interaction.options.getChannel('infraction_channel');
        const promotionChannel        = interaction.options.getChannel('promotion_channel');
        const staffRequestChannel     = interaction.options.getChannel('staffrequest_channel');
        const shiftChannel            = interaction.options.getChannel('shift_channel');
        const flagChannel             = interaction.options.getChannel('flag_channel');
        const flagRole1               = interaction.options.getRole('flag_role_1');
        const flagRole2               = interaction.options.getRole('flag_role_2');
        const flagRole3               = interaction.options.getRole('flag_role_3');
        const ticketPanelChannel      = interaction.options.getChannel('ticket_panel_channel');
        const ticketCategory          = interaction.options.getChannel('ticket_category');
        const ticketSupportRole       = interaction.options.getRole('ticket_support_role');
        const ticketTranscriptChannel = interaction.options.getChannel('ticket_transcript_channel');
        const managementCategory      = interaction.options.getChannel('management_category');
        const directorshipCategory    = interaction.options.getChannel('directorship_category');
        const ownershipCategory       = interaction.options.getChannel('ownership_category');

        const nothingProvided = !ssuChannel && !pingRole && !logsChannel && !priorityChannel
            && !infractionChannel && !promotionChannel && !staffRequestChannel && !shiftChannel
            && !flagChannel && !flagRole1 && !flagRole2 && !flagRole3
            && !ticketPanelChannel && !ticketCategory && !ticketSupportRole
            && !ticketTranscriptChannel && !managementCategory && !directorshipCategory && !ownershipCategory;

        if (nothingProvided) {
            const existing = client.settings.get(interaction.guild.id) || {};
            const statusEmbed = new EmbedBuilder()
                .setTitle('Current Server Configuration')
                .setColor(0x5865F2)
                .addFields(
                    { name: '📢 SSU Channel',              value: existing.ssuChannelId              ? `<#${existing.ssuChannelId}>`              : 'Not configured', inline: true },
                    { name: '🔔 Ping Role',                value: existing.pingRoleId                ? `<@&${existing.pingRoleId}>`               : 'Not configured', inline: true },
                    { name: '📝 Logs Channel',             value: existing.logsChannelId             ? `<#${existing.logsChannelId}>`             : 'Not configured', inline: true },
                    { name: '🚨 Priority Channel',         value: existing.priorityChannelId         ? `<#${existing.priorityChannelId}>`         : 'Not configured', inline: true },
                    { name: '⚠️ Infraction Channel',       value: existing.infractionChannelId       ? `<#${existing.infractionChannelId}>`       : 'Not configured', inline: true },
                    { name: '🎉 Promotion Channel',        value: existing.promotionChannelId        ? `<#${existing.promotionChannelId}>`        : 'Not configured', inline: true },
                    { name: '🆘 Staff Request Channel',    value: existing.staffRequestChannelId     ? `<#${existing.staffRequestChannelId}>`     : 'Not configured', inline: true },
                    { name: '📊 Shift Channel',            value: existing.shiftChannelId            ? `<#${existing.shiftChannelId}>`            : 'Not configured', inline: true },
                    { name: '🚩 Flag Channel',             value: existing.flagChannelId             ? `<#${existing.flagChannelId}>`             : 'Not configured (uses shift channel)', inline: true },
                    { name: '━━ Ticket System ━━',         value: '\u200b',                                                                                           inline: false },
                    { name: '🎫 Ticket Panel',             value: existing.ticketPanelChannelId      ? `<#${existing.ticketPanelChannelId}>`      : 'Not configured', inline: true },
                    { name: '📁 Ticket Category',          value: existing.ticketCategoryId          ? `<#${existing.ticketCategoryId}>`          : 'Not configured', inline: true },
                    { name: '🛡️ Support Role',             value: existing.ticketSupportRoleId       ? `<@&${existing.ticketSupportRoleId}>`      : 'Not configured', inline: true },
                    { name: '📄 Transcript Channel',       value: existing.ticketTranscriptChannelId ? `<#${existing.ticketTranscriptChannelId}>` : 'Not configured', inline: true },
                    { name: '⬆️ Management Category',      value: existing.managementCategoryId      ? `<#${existing.managementCategoryId}>`      : 'Not configured', inline: true },
                    { name: '⬆️ Directorship Category',    value: existing.directorshipCategoryId    ? `<#${existing.directorshipCategoryId}>`    : 'Not configured', inline: true },
                    { name: '⬆️ Ownership Category',       value: existing.ownershipCategoryId       ? `<#${existing.ownershipCategoryId}>`       : 'Not configured', inline: true },
                    {
                        name: '📣 Flag Ping Roles',
                        value: existing.flagRoleIds?.length ? existing.flagRoleIds.map(id => `<@&${id}>`).join(' ') : 'Not configured',
                        inline: false,
                    },
                )
                .setFooter({ text: 'Run /setup with options to update any of these settings.' })
                .setTimestamp();

            return interaction.editReply({ embeds: [statusEmbed] });
        }

        const guildId  = interaction.guild.id;
        const existing = client.settings.get(guildId) || {};
        const updates  = {};

        // ── Existing settings ─────────────────────────────────────────────────
        if (ssuChannel)          updates.ssuChannelId          = ssuChannel.id;
        if (pingRole)            updates.pingRoleId             = pingRole.id;
        if (logsChannel)         updates.logsChannelId          = logsChannel.id;
        if (infractionChannel)   updates.infractionChannelId    = infractionChannel.id;
        if (promotionChannel)    updates.promotionChannelId     = promotionChannel.id;
        if (staffRequestChannel) updates.staffRequestChannelId  = staffRequestChannel.id;
        if (shiftChannel)        updates.shiftChannelId         = shiftChannel.id;
        if (flagChannel)         updates.flagChannelId           = flagChannel.id;

        if (flagRole1 || flagRole2 || flagRole3) {
            const newIds = [flagRole1, flagRole2, flagRole3].filter(Boolean).map(r => r.id);
            const merged = [...new Set([...(existing.flagRoleIds || []), ...newIds])].slice(0, 3);
            updates.flagRoleIds = merged;
        }

        if (priorityChannel) {
            updates.priorityChannelId = priorityChannel.id;
            try {
                const sent = await priorityChannel.send({
                    embeds: [buildPriorityEmbed(false)],
                    components: [buildPriorityRow(false)],
                });
                updates.priorityMessageId = sent.id;
            } catch (e) {
                console.error('[Setup] Failed to send priority button:', e.message);
                return interaction.editReply({
                    content: `Could not send priority button to <#${priorityChannel.id}>. Make sure I have permission to send messages there.`,
                });
            }
        }

        // ── Ticket System settings ─────────────────────────────────────────────
        if (ticketCategory)          updates.ticketCategoryId          = ticketCategory.id;
        if (ticketSupportRole)       updates.ticketSupportRoleId       = ticketSupportRole.id;
        if (ticketTranscriptChannel) updates.ticketTranscriptChannelId = ticketTranscriptChannel.id;
        if (managementCategory)      updates.managementCategoryId      = managementCategory.id;
        if (directorshipCategory)    updates.directorshipCategoryId    = directorshipCategory.id;
        if (ownershipCategory)       updates.ownershipCategoryId       = ownershipCategory.id;

        if (ticketPanelChannel) {
            updates.ticketPanelChannelId = ticketPanelChannel.id;
            try {
                const sent = await ticketPanelChannel.send({
                    components: [buildTicketPanelContainer()],
                    flags: TICKET_FLAGS,
                });
                updates.ticketPanelMessageId = sent.id;
            } catch (e) {
                console.error('[Setup] Failed to send ticket panel:', e.message);
                return interaction.editReply({
                    content: `Could not send ticket panel to <#${ticketPanelChannel.id}>. Make sure I have permission to send messages there.`,
                });
            }
        }

        client.settings.set(guildId, { ...existing, ...updates });
        const saved = client.settings.get(guildId);

        const resultEmbed = new EmbedBuilder()
            .setTitle('✅ Setup Updated')
            .setColor(0x57F287)
            .addFields(
                { name: '📢 SSU Channel',              value: saved.ssuChannelId              ? `<#${saved.ssuChannelId}>`              : 'Not configured', inline: true },
                { name: '🔔 Ping Role',                value: saved.pingRoleId                ? `<@&${saved.pingRoleId}>`               : 'Not configured', inline: true },
                { name: '📝 Logs Channel',             value: saved.logsChannelId             ? `<#${saved.logsChannelId}>`             : 'Not configured', inline: true },
                { name: '🚨 Priority Channel',         value: saved.priorityChannelId         ? `<#${saved.priorityChannelId}>`         : 'Not configured', inline: true },
                { name: '⚠️ Infraction Channel',       value: saved.infractionChannelId       ? `<#${saved.infractionChannelId}>`       : 'Not configured', inline: true },
                { name: '🎉 Promotion Channel',        value: saved.promotionChannelId        ? `<#${saved.promotionChannelId}>`        : 'Not configured', inline: true },
                { name: '🆘 Staff Request Channel',    value: saved.staffRequestChannelId     ? `<#${saved.staffRequestChannelId}>`     : 'Not configured', inline: true },
                { name: '📊 Shift Channel',            value: saved.shiftChannelId            ? `<#${saved.shiftChannelId}>`            : 'Not configured', inline: true },
                { name: '🚩 Flag Channel',             value: saved.flagChannelId             ? `<#${saved.flagChannelId}>`             : 'Not configured (uses shift channel)', inline: true },
                { name: '━━ Ticket System ━━',         value: '\u200b',                                                                                        inline: false },
                { name: '🎫 Ticket Panel',             value: saved.ticketPanelChannelId      ? `<#${saved.ticketPanelChannelId}>`      : 'Not configured', inline: true },
                { name: '📁 Ticket Category',          value: saved.ticketCategoryId          ? `<#${saved.ticketCategoryId}>`          : 'Not configured', inline: true },
                { name: '🛡️ Support Role',             value: saved.ticketSupportRoleId       ? `<@&${saved.ticketSupportRoleId}>`      : 'Not configured', inline: true },
                { name: '📄 Transcript Channel',       value: saved.ticketTranscriptChannelId ? `<#${saved.ticketTranscriptChannelId}>` : 'Not configured', inline: true },
                { name: '⬆️ Management Category',      value: saved.managementCategoryId      ? `<#${saved.managementCategoryId}>`      : 'Not configured', inline: true },
                { name: '⬆️ Directorship Category',    value: saved.directorshipCategoryId    ? `<#${saved.directorshipCategoryId}>`    : 'Not configured', inline: true },
                { name: '⬆️ Ownership Category',       value: saved.ownershipCategoryId       ? `<#${saved.ownershipCategoryId}>`       : 'Not configured', inline: true },
                {
                    name: '📣 Flag Ping Roles',
                    value: saved.flagRoleIds?.length ? saved.flagRoleIds.map(id => `<@&${id}>`).join(' ') : 'Not configured',
                    inline: false,
                },
            )
            .setFooter({ text: `Updated by ${interaction.user.username}` })
            .setTimestamp();

        return interaction.editReply({ embeds: [resultEmbed] });
    },
};

async function safeReply(interaction, options) {
    try {
        if (interaction.deferred || interaction.replied) return interaction.editReply(options);
        return interaction.reply(options);
    } catch (e) {
        console.error('[Setup] safeReply failed:', e.message);
    }
}
