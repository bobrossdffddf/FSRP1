const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ChannelType,
} = require('discord.js');

const { buildPriorityEmbed, buildPriorityRow } = require('../utils/priorityMessage');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('(Admin only) Configure this server\'s settings.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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
            option.setName('flag_role_3').setDescription('Third management role to ping (e.g. Ownership Team).').setRequired(false)),

    async execute(interaction, client) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return safeReply(interaction, { content: 'Only server administrators can use `/setup`.', flags: 64 });
        }

        await interaction.deferReply({ flags: 64 }).catch(() => {});

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

        const nothingProvided = !ssuChannel && !pingRole && !logsChannel && !priorityChannel
            && !infractionChannel && !promotionChannel && !staffRequestChannel && !shiftChannel
            && !flagChannel && !flagRole1 && !flagRole2 && !flagRole3;

        const buildConfigFields = (cfg) => [
            { name: '📢 SSU Channel',              value: cfg.ssuChannelId              ? `<#${cfg.ssuChannelId}>`              : 'Not configured', inline: true },
            { name: '🔔 Ping Role',                value: cfg.pingRoleId                ? `<@&${cfg.pingRoleId}>`               : 'Not configured', inline: true },
            { name: '📝 Logs Channel',             value: cfg.logsChannelId             ? `<#${cfg.logsChannelId}>`             : 'Not configured', inline: true },
            { name: '🚨 Priority Channel',         value: cfg.priorityChannelId         ? `<#${cfg.priorityChannelId}>`         : 'Not configured', inline: true },
            { name: '⚠️ Infraction Channel',       value: cfg.infractionChannelId       ? `<#${cfg.infractionChannelId}>`       : 'Not configured', inline: true },
            { name: '🎉 Promotion Channel',        value: cfg.promotionChannelId        ? `<#${cfg.promotionChannelId}>`        : 'Not configured', inline: true },
            { name: '🆘 Staff Request Channel',    value: cfg.staffRequestChannelId     ? `<#${cfg.staffRequestChannelId}>`     : 'Not configured', inline: true },
            { name: '📊 Shift Channel',            value: cfg.shiftChannelId            ? `<#${cfg.shiftChannelId}>`            : 'Not configured', inline: true },
            { name: '🚩 Flag Channel',             value: cfg.flagChannelId             ? `<#${cfg.flagChannelId}>`             : 'Not configured (uses shift channel)', inline: true },
            {
                name: '📣 Flag Ping Roles',
                value: cfg.flagRoleIds?.length ? cfg.flagRoleIds.map(id => `<@&${id}>`).join(' ') : 'Not configured',
                inline: false,
            },
        ];

        if (nothingProvided) {
            const existing = client.settings.get(interaction.guild.id) || {};
            const statusEmbed = new EmbedBuilder()
                .setTitle('Current Server Configuration')
                .setColor(0x5865F2)
                .addFields(buildConfigFields(existing))
                .setFooter({ text: 'Run /setup with options to update any of these settings.' })
                .setTimestamp();

            return interaction.editReply({ embeds: [statusEmbed] });
        }

        const guildId  = interaction.guild.id;
        const existing = client.settings.get(guildId) || {};
        const updates  = {};

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
        }

        client.settings.set(guildId, { ...existing, ...updates });

        if (priorityChannel) {
            await priorityChannel.send({ embeds: [buildPriorityEmbed(false)], components: [buildPriorityRow(false)] })
                .then(sent => { updates.priorityMessageId = sent.id; })
                .catch(e => console.error('[Setup] Failed to send priority button:', e.message));
            client.settings.set(guildId, { ...existing, ...updates });
        }

        const saved = client.settings.get(guildId);

        const resultEmbed = new EmbedBuilder()
            .setTitle('✅ Setup Updated')
            .setColor(0x57F287)
            .addFields(buildConfigFields(saved))
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
