const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getServerInfo } = require('../api/erlc');
const { upsertAnnouncementMessage } = require('../utils/announcementMessage');
const { setPriorityButtonState } = require('../utils/priorityMessage');
const { setSsuChannelState } = require('../utils/serverVoiceChannels');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ssu')
        .setDescription('Announce a Server Start Up (SSU).')
        .setDefaultMemberPermissions(0n),

    async execute(interaction, client) {
        // Defer separately so a stale/slow interaction doesn't abort the business logic
        let deferred = false;
        try {
            await interaction.deferReply({ flags: 64 });
            deferred = true;
        } catch (e) {
            console.error('[SSU] Failed to defer interaction:', e.message);
        }

        const safeReply = async (content) => {
            if (!deferred) return;
            try {
                await interaction.editReply(typeof content === 'string' ? { content } : content);
            } catch (e) {
                console.error('[SSU] Failed to edit reply:', e.message);
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

            const serverInfo = await getServerInfo();
            let joinCodeInfo = '';
            let playerCount = 'N/A';
            let queueCount = 'N/A';

            if (serverInfo) {
                joinCodeInfo = `Server Code: \`${serverInfo.JoinKey}\``;
                playerCount = `${serverInfo.CurrentPlayers}/${serverInfo.MaxPlayers}`;
                queueCount = serverInfo.QueuePlayers || '0';
            }

            const embed = new EmbedBuilder()
                .setTitle('Server Start Up')
                .setColor('#3498db')
                .setDescription(`We are currently hosting a Server Start Up! Come join our server and roleplay with us.\n\n${joinCodeInfo}\n**Players:** ${playerCount}\n**Queue:** ${queueCount}`)
                .setImage('https://i.postimg.cc/59HmqpCR/INFormation.png')
                .setFooter({ text: 'Florida State Roleplay', iconURL: 'https://i.postimg.cc/XY2ZP6S4/e685831118b4a57719b8d66f3092f542.png' })
                .setTimestamp();

            const pingRole = settings.pingRoleId ? `<@&${settings.pingRoleId}>` : '';
            await upsertAnnouncementMessage({
                client,
                guildId,
                channel: ssuChannel,
                content: pingRole,
                embeds: [embed],
                components: [],
                announcementMessageId,
            });

            // Re-enable the priority request button now that the server is up
            await setPriorityButtonState(client, guildId, false);

            await safeReply('SSU Announced successfully.');

            // Run channel renames after replying — they are rate-limited by Discord and
            // should not block the interaction response or clog the REST queue.
            setSsuChannelState({ guild: interaction.guild, client, isSsu: true, joinCode: serverInfo?.JoinKey })
                .catch(e => console.error('[SSU] Channel state error:', e.message));

        } catch (e) {
            console.error('[SSU] Error:', e.message);
            await safeReply('Failed to send SSU announcement. Check permissions.');
        }
    },
};
