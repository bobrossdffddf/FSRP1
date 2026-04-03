const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
} = require('discord.js');

const { buildPriorityEmbed, buildPriorityRow } = require('../utils/priorityMessage');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('(Admin only) Configure this server\'s settings.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(option =>
            option
                .setName('ssu_channel')
                .setDescription('Channel where SSU/SSD session announcements are sent.')
                .setRequired(false))
        .addRoleOption(option =>
            option
                .setName('ping_role')
                .setDescription('Role to ping when an SSU vote is started.')
                .setRequired(false))
        .addChannelOption(option =>
            option
                .setName('logs_channel')
                .setDescription('Channel where general bot command logs are posted.')
                .setRequired(false))
        .addChannelOption(option =>
            option
                .setName('priority_channel')
                .setDescription('Channel to post the "Request a Priority" button.')
                .setRequired(false)),

    async execute(interaction, client) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: 'Only server administrators can use `/setup`.',
                flags: 64
            });
        }

        const ssuChannel = interaction.options.getChannel('ssu_channel');
        const pingRole = interaction.options.getRole('ping_role');
        const logsChannel = interaction.options.getChannel('logs_channel');
        const priorityChannel = interaction.options.getChannel('priority_channel');

        const nothingProvided = !ssuChannel && !pingRole && !logsChannel && !priorityChannel;

        if (nothingProvided) {
            const existing = client.settings.get(interaction.guild.id) || {};

            const statusEmbed = new EmbedBuilder()
                .setTitle('Current Server Configuration')
                .setColor(0x5865F2)
                .addFields(
                    { name: '📢 SSU Channel', value: existing.ssuChannelId ? `<#${existing.ssuChannelId}>` : 'Not configured', inline: true },
                    { name: '🔔 Ping Role', value: existing.pingRoleId ? `<@&${existing.pingRoleId}>` : 'Not configured', inline: true },
                    { name: '📝 Logs Channel', value: existing.logsChannelId ? `<#${existing.logsChannelId}>` : 'Not configured', inline: true },
                    { name: '🚨 Priority Channel', value: existing.priorityChannelId ? `<#${existing.priorityChannelId}>` : 'Not configured', inline: true }
                )
                .setFooter({ text: 'Run /setup with options to update any of these settings.' })
                .setTimestamp();

            return interaction.reply({ embeds: [statusEmbed], flags: 64 });
        }

        const guildId = interaction.guild.id;
        const existing = client.settings.get(guildId) || {};
        const updates = {};

        if (ssuChannel) updates.ssuChannelId = ssuChannel.id;
        if (pingRole) updates.pingRoleId = pingRole.id;
        if (logsChannel) updates.logsChannelId = logsChannel.id;

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
                return interaction.reply({
                    content: `Could not send priority button to <#${priorityChannel.id}>. Make sure I have permission to send messages there.`,
                    flags: 64,
                });
            }
        }

        client.settings.set(guildId, { ...existing, ...updates });
        const saved = client.settings.get(guildId);

        const resultEmbed = new EmbedBuilder()
            .setTitle('✅ Setup Updated')
            .setColor(0x57F287)
            .addFields(
                { name: '📢 SSU Channel', value: saved.ssuChannelId ? `<#${saved.ssuChannelId}>` : 'Not configured', inline: true },
                { name: '🔔 Ping Role', value: saved.pingRoleId ? `<@&${saved.pingRoleId}>` : 'Not configured', inline: true },
                { name: '📝 Logs Channel', value: saved.logsChannelId ? `<#${saved.logsChannelId}>` : 'Not configured', inline: true },
                { name: '🚨 Priority Channel', value: saved.priorityChannelId ? `<#${saved.priorityChannelId}>` : 'Not configured', inline: true }
            )
            .setFooter({ text: `Updated by ${interaction.user.username}` })
            .setTimestamp();

        return interaction.reply({ embeds: [resultEmbed], flags: 64 });
    },
};
