const {
    SlashCommandBuilder,
    EmbedBuilder,
} = require('discord.js');
const { getTicketData } = require('../utils/ticketManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rename')
        .setDescription('Rename this ticket channel. (Claimer only)')
        .addStringOption(option =>
            option
                .setName('name')
                .setDescription('The new name for this ticket channel')
                .setRequired(true)
                .setMaxLength(80)
        ),

    async execute(interaction, client) {
        const ticket = getTicketData(client, interaction.channel.id);

        if (!ticket) {
            return interaction.reply({ content: 'This command can only be used inside a ticket channel.', flags: 64 });
        }

        if (ticket.claimedBy !== interaction.user.id) {
            return interaction.reply({ content: 'Only the staff member who claimed this ticket can rename it.', flags: 64 });
        }

        const newName = interaction.options.getString('name')
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '')
            .slice(0, 80);

        if (!newName) {
            return interaction.reply({ content: 'Invalid channel name. Please use letters, numbers, and hyphens only.', flags: 64 });
        }

        await interaction.deferReply({ flags: 64 });

        try {
            const oldName = interaction.channel.name;
            await interaction.channel.setName(newName, `Renamed by ${interaction.user.username}`);

            const embed = new EmbedBuilder()
                .setTitle('✏️ Ticket Renamed')
                .setColor(0x57F287)
                .setDescription(`This ticket channel has been renamed by ${interaction.user}.`)
                .addFields(
                    { name: 'Previous Name', value: `\`${oldName}\``, inline: true },
                    { name: 'New Name', value: `\`${newName}\``, inline: true },
                )
                .setTimestamp()
                .setFooter({ text: 'Ticket System' });

            await interaction.channel.send({ embeds: [embed] });
            await interaction.editReply({ content: `Channel renamed to \`${newName}\`.` });
        } catch (err) {
            console.error('[Rename] Error:', err.message);
            await interaction.editReply({ content: 'Failed to rename the channel. Make sure I have the Manage Channels permission.' });
        }
    },
};
