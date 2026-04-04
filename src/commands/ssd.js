const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { runCommand } = require('../api/erlc');
const { upsertAnnouncementMessage } = require('../utils/announcementMessage');
const { setPriorityButtonState } = require('../utils/priorityMessage');
const { setSsuChannelState } = require('../utils/serverVoiceChannels');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ssd')
        .setDescription('Announce a Server Shutdown (SSD).')
        .setDefaultMemberPermissions(0n),

    async execute(interaction, client) {
        try {
            await interaction.deferReply({ flags: 64 });

            const guildId = interaction.guild.id;
            const settings = client.settings.get(guildId);

            if (!settings || !settings.ssuChannelId) {
                return await interaction.editReply({ content: 'Please configure the bot with `/setup` first.' });
            }

            const ssuChannel = client.channels.cache.get(settings.ssuChannelId);
            if (!ssuChannel) {
                return await interaction.editReply({ content: 'The configured SSU channel could not be found.' });
            }

            const announcementMessageId = settings.announcementMessageId;

            const embed = new EmbedBuilder()
                .setTitle('Server Shutdown')
                .setColor('#2C2F33')
                .setDescription('We would like to thank everyone that has came to our server to roleplay, but we will be shutting down our community for the time being. Check this channel again for more information on our next start up.')
                .setImage('https://i.postimg.cc/C5YL1cTq/Startup.png')
                .setFooter({ text: 'Florida State Roleplay' })
                .setTimestamp();

            await upsertAnnouncementMessage({
                client,
                guildId,
                channel: ssuChannel,
                embeds: [embed],
                components: [],
                announcementMessageId,
            });

            // Grey out / disable the priority request button during SSD
            await setPriorityButtonState(client, guildId, true);

            await setSsuChannelState({
                guild: interaction.guild,
                client,
                isSsu: false,
            });

            const shutdownResult = await runCommand(':shutdown');
            let msg;
            if (shutdownResult !== null) {
                console.log('[SSD] :shutdown command sent to ERLC server.');
                msg = 'SSD Announced successfully and `:shutdown` sent to the ERLC server.';
            } else {
                msg = 'SSD Announced successfully, but failed to send `:shutdown` to ERLC. Check the API key.';
            }
            await interaction.editReply(msg);
        } catch (e) {
            console.error('[SSD] Error:', e.message);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: 'Failed to send SSD announcement. Check permissions.', flags: 64 });
                } else if (interaction.deferred) {
                    await interaction.editReply({ content: 'Failed to send SSD announcement. Check permissions.' });
                }
            } catch (replyError) {
                console.error('Failed to send error reply:', replyError.message);
            }
        }
    },
};
