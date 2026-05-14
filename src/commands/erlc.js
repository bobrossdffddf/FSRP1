const { SlashCommandBuilder } = require('discord.js');
const { runCommand } = require('../api/erlc');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('erlc')
        .setDescription('Execute an in-game ERLC command.')
        .setDefaultMemberPermissions(0n)
        .addStringOption(option =>
            option.setName('command')
                .setDescription('The command to run (e.g. m Hello Server!)')
                .setRequired(true)),

    async execute(interaction, client) {
        try {
            const cmd = interaction.options.getString('command');

            // Ensure command starts with a colon if the user forgot it, though PRC uses colon for all commands. Let's let the user type whatever like `m Hello` or `:m Hello` just in case. They usually type it without the colon if it's like a discord input but let's assume they know how PRC commands work.
            const prcCmd = cmd.startsWith(':') ? cmd : `:${cmd}`;

            // Always defer immediately
            await interaction.deferReply({ flags: 0 });

            const result = await runCommand(prcCmd);

            const message = result ? `Executed \`${prcCmd}\` in the server successfully.` : `Failed to execute \`${prcCmd}\`. Please check the bot console or API key.`;
            await interaction.editReply(message);
        } catch (error) {
            console.error('ERLC command error:', error.message);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: 'There was an error executing this command.', flags: 0 });
                } else if (interaction.deferred) {
                    await interaction.editReply({ content: 'There was an error executing this command.' });
                }
            } catch (e) {
                console.error('Failed to send error reply:', e.message);
            }
        }
    },
};
