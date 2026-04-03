const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { upsertAnnouncementMessage } = require('../utils/announcementMessage');

const activeVotes = new Map();

function buildProgressBar(current, total, guild) {
    const emojiBLine = guild.emojis.cache.find(e => e.name === 'BLine');
    const fillChar = emojiBLine ? `${emojiBLine}` : '🟦';
    const emptyChar = '⬛';
    const barLength = 10;
    const filled = Math.round((current / total) * barLength);
    const empty = barLength - filled;
    return fillChar.repeat(filled) + emptyChar.repeat(empty);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ssu-vote')
        .setDescription('Start a vote for an SSU.')
        .setDefaultMemberPermissions(0n)
        .addIntegerOption(option =>
            option.setName('votes_needed')
                .setDescription('Number of votes required to pass (default 5).')
                .setRequired(false)),

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

            const targetVotes = interaction.options.getInteger('votes_needed') || 5;
            const pingRole = settings.pingRoleId ? `<@&${settings.pingRoleId}>` : '@here';
            const initiator = interaction.user;

            const progressBar = buildProgressBar(0, targetVotes, interaction.guild);

            const embed = new EmbedBuilder()
                .setTitle('Session Poll')
                .setDescription(`We have now initiated a session vote. Please react below if you're willing to attend today's session. We require **${targetVotes}** votes to start a session.\n\n${progressBar}`)
                .setColor('#5865F2')
                .setImage('https://i.postimg.cc/59HmqpCR/INFormation.png');

            const voteBtn = new ButtonBuilder()
                .setCustomId('vote_btn')
                .setLabel(`Vote (0/${targetVotes})`)
                .setStyle(ButtonStyle.Success);

            const viewVotesBtn = new ButtonBuilder()
                .setCustomId('view_votes_btn')
                .setLabel('View Votes')
                .setStyle(ButtonStyle.Primary);

            const row = new ActionRowBuilder().addComponents(voteBtn, viewVotesBtn);

            const announcementMessageId = settings.announcementMessageId;
            const message = await upsertAnnouncementMessage({
                client,
                guildId,
                channel: ssuChannel,
                content: pingRole,
                embeds: [embed],
                components: [row],
                announcementMessageId,
            });

            activeVotes.set(message.id, {
                targetVotes,
                voters: new Set(),
                initiatorId: initiator.id,
            });

            await interaction.editReply({ content: 'Vote started successfully.' });
        } catch (e) {
            console.error('[SSU Vote] Error:', e.message);
            try {
                if (interaction.deferred) {
                    await interaction.editReply({ content: 'Failed to start vote. Check permissions.' });
                }
            } catch (replyError) {
                console.error('Failed to send error reply:', replyError.message);
            }
        }
    },

    activeVotes,
    buildProgressBar,
};
