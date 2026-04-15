const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
} = require('discord.js');
const { getTicketData, setTicketData } = require('../utils/ticketManager');

const ESCALATION_LEVELS = {
    Management: 'managementCategoryId',
    Directorship: 'directorshipCategoryId',
    Ownership: 'ownershipCategoryId',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('escalate')
        .setDescription('Escalate this ticket to a higher authority. (Claimer only)')
        .addStringOption(option =>
            option
                .setName('level')
                .setDescription('Who to escalate to')
                .setRequired(true)
                .addChoices(
                    { name: 'Management', value: 'Management' },
                    { name: 'Directorship', value: 'Directorship' },
                    { name: 'Ownership', value: 'Ownership' },
                )
        ),

    async execute(interaction, client) {
        const ticket = getTicketData(client, interaction.channel.id);

        if (!ticket) {
            return interaction.reply({ content: 'This command can only be used inside a ticket channel.', flags: 64 });
        }

        if (ticket.claimedBy !== interaction.user.id) {
            return interaction.reply({ content: 'Only the staff member who claimed this ticket can escalate it.', flags: 64 });
        }

        const level = interaction.options.getString('level');
        const settingKey = ESCALATION_LEVELS[level];
        const settings = client.settings.get(interaction.guild.id) || {};
        const targetCategoryId = settings[settingKey];

        if (!targetCategoryId) {
            return interaction.reply({
                content: `The **${level}** escalation category has not been configured. An admin needs to run \`/setup\` to configure it.`,
                flags: 64,
            });
        }

        await interaction.deferReply({ flags: 64 });

        try {
            const category = await interaction.guild.channels.fetch(targetCategoryId).catch(() => null);
            if (!category) {
                return interaction.editReply({ content: `Could not find the ${level} category. Please reconfigure it with \`/setup\`.` });
            }

            // Move the channel to the new category and sync permissions
            await interaction.channel.setParent(targetCategoryId, {
                lockPermissions: false,
                reason: `Ticket escalated to ${level} by ${interaction.user.username}`,
            });

            // Get the role for that level if configured
            const roleKey = `${level.toLowerCase()}RoleId`;
            const escalationRoleId = settings[roleKey];

            // Add permissions for the escalation role if set
            if (escalationRoleId) {
                await interaction.channel.permissionOverwrites.edit(escalationRoleId, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true,
                }).catch(() => {});
            }

            setTicketData(client, interaction.channel.id, {
                escalationLevel: level,
            });

            const embed = new EmbedBuilder()
                .setTitle('⬆️ Ticket Escalated')
                .setColor(0xFEE75C)
                .setDescription(`This ticket has been escalated to **${level}** by ${interaction.user}.`)
                .addFields(
                    { name: 'Escalated By', value: `${interaction.user}`, inline: true },
                    { name: 'Escalation Level', value: level, inline: true },
                )
                .setTimestamp()
                .setFooter({ text: 'Ticket System' });

            await interaction.channel.send({ embeds: [embed] });
            await interaction.editReply({ content: `Ticket successfully escalated to **${level}**.` });
        } catch (err) {
            console.error('[Escalate] Error:', err.message);
            await interaction.editReply({ content: 'An error occurred while escalating the ticket.' });
        }
    },
};
