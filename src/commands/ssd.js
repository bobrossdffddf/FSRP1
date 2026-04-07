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
        // Defer separately so a stale/slow interaction doesn't abort the business logic
        let deferred = false;
        try {
            await interaction.deferReply({ flags: 64 });
            deferred = true;
        } catch (e) {
            console.error('[SSD] Failed to defer interaction:', e.message);
        }

        const safeReply = async (content) => {
            if (!deferred) return;
            try {
                await interaction.editReply(typeof content === 'string' ? { content } : content);
            } catch (e) {
                console.error('[SSD] Failed to edit reply:', e.message);
            }
        };

        try {
            const guildId = interaction.guild.id;
            const settings = client.settings.get(guildId);

            if (!settings || !settings.ssuChannelId) {
                return await safeReply('Please configure the bot with `/setup` first.');
            }

            const ssuChannel = client.channels.cache.get(settings.ssuChannelId);
            if (!ssuChannel) {
                return await safeReply('The configured SSU channel could not be found.');
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

            const shutdownResult = await runCommand(':shutdown');
            let msg;
            if (shutdownResult !== null) {
                console.log('[SSD] :shutdown command sent to ERLC server.');
                msg = 'SSD Announced successfully and `:shutdown` sent to the ERLC server.';
            } else {
                msg = 'SSD Announced successfully, but failed to send `:shutdown` to ERLC. Check the API key.';
            }

            await safeReply(msg);

            // Run channel renames after replying — they are rate-limited by Discord and
            // should not block the interaction response or clog the REST queue.
            setSsuChannelState({ guild: interaction.guild, client, isSsu: false })
                .catch(e => console.error('[SSD] Channel state error:', e.message));

        } catch (e) {
            console.error('[SSD] Error:', e.message);
            await safeReply('Failed to send SSD announcement. Check permissions.');
        }
    },
};
