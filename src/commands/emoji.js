const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('emoji')
        .setDescription('Lists all server emojis with their bot format IDs.')
        .setDefaultMemberPermissions(0n),

    async execute(interaction, client) {
        try {
            // Always defer immediately (MUST be first)
            await interaction.deferReply({ flags: 64 });

            const guild = interaction.guild;
            const emojis = guild.emojis.cache;

            if (emojis.size === 0) {
                return await interaction.editReply({ content: 'This server has no custom emojis.' });
            }

            // Split into chunks if there are too many emojis for one embed
            const emojiList = emojis.map(e => {
                const animated = e.animated ? 'a' : '';
                const format = `<${animated}:${e.name}:${e.id}>`;
                return `${e} \`${format}\` — **${e.name}**`;
            });

            // Discord embed description limit is 4096 chars, split if needed
            const chunks = [];
            let current = '';
            for (const line of emojiList) {
                if ((current + '\n' + line).length > 3900) {
                    chunks.push(current);
                    current = line;
                } else {
                    current += (current ? '\n' : '') + line;
                }
            }
            if (current) chunks.push(current);

            for (let i = 0; i < chunks.length; i++) {
                const embed = new EmbedBuilder()
                    .setTitle(i === 0 ? `Server Emojis (${emojis.size} total)` : `Server Emojis (cont.)`)
                    .setDescription(chunks[i])
                    .setColor('#5865F2');

                if (i === 0) {
                    await interaction.editReply({ embeds: [embed] });
                } else {
                    await interaction.followUp({ embeds: [embed], flags: 64 });
                }
            }
        } catch (error) {
            console.error('Emoji command error:', error.message);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: 'There was an error executing this command.', flags: 64 });
                } else if (interaction.deferred) {
                    await interaction.editReply({ content: 'There was an error executing this command.' });
                }
            } catch (e) {
                console.error('Failed to send error reply:', e.message);
            }
        }
    },
};
