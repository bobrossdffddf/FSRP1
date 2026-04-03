const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getPlayers, getPlayerName, getPlayerId } = require('../api/erlc');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playerlist')
        .setDescription('View the current server player list with VC and comms status.')
        .setDefaultMemberPermissions(0n),

    async execute(interaction, client) {
        try {
            await interaction.deferReply({ flags: 64 });

            const inGamePlayers = await getPlayers();
            if (!inGamePlayers || !Array.isArray(inGamePlayers)) {
                return await interaction.editReply({ content: 'Failed to fetch player list from the ERLC API.' });
            }

            const guild = interaction.guild;
            const staffCount = inGamePlayers.filter(p => p.Permission !== 'Normal').length;

            const emojiStaff = guild.emojis.cache.find(e => e.name === 'Staff');
            const emojiDiscord = guild.emojis.cache.find(e => e.name === 'Discord');
            const emojiMic = guild.emojis.cache.find(e => e.name === 'mic');
            const emojiBLine = guild.emojis.cache.find(e => e.name === 'BLine');

            const staffStr = emojiStaff ? `${emojiStaff}` : '🛡️';
            const discordStr = emojiDiscord ? `${emojiDiscord}` : '💬';
            const micStr = emojiMic ? `${emojiMic}` : '🎙️';
            const bLineStr = emojiBLine ? `${emojiBLine}` : '';

            let lines = [];
            let notInVCCount = 0;
            let notInCommsCount = 0;

            for (const player of inGamePlayers) {
                const username = getPlayerName(player.Player);
                const robloxId = getPlayerId(player.Player);
                const team = player.Team || 'Civilian';
                const callsign = player.Callsign ? ` ${player.Callsign}` : '';
                const isStaff = player.Permission !== 'Normal';

                const normalized = username.toLowerCase();
                const member = guild.members.cache.find(m => {
                    const nick = (m.nickname || '').toLowerCase();
                    const globalName = (m.user.globalName || '').toLowerCase();
                    const uname = (m.user.username || '').toLowerCase();
                    return nick.includes(normalized) || globalName.includes(normalized) || uname.includes(normalized);
                });

                let icons = '';
                if (!member) {
                    notInCommsCount++;
                } else {
                    if (member.voice.channelId) {
                        icons = micStr;
                    } else {
                        notInVCCount++;
                        icons = discordStr;
                    }
                }

                const staffBadge = isStaff ? ` ${staffStr}` : '';
                const line = `\u2022 ${icons ? icons + ' ' : ''}**${username}** ${robloxId} \u2022 ${team}${callsign}${staffBadge}`;
                lines.push(line);
            }

            const embed = new EmbedBuilder()
                .setAuthor({ name: 'Florida State Roleplay' })
                .setTitle('Server Players')
                .setColor('#2C2F33')
                .setDescription(lines.join('\n') || 'No players currently in server.')
                .setFooter({ text: `${inGamePlayers.length}/40 Players \u2022 ${staffCount} Staff` })
                .setTimestamp();

            const summaryParts = [];
            summaryParts.push(`${micStr} In VC  ${bLineStr ? bLineStr + ' ' : '\u2022 '}${discordStr} In comms only`);
            summaryParts.push(`**Not in VC:** ${notInVCCount}  ${bLineStr ? bLineStr + ' ' : '\u2022 '}**Not in comms:** ${notInCommsCount}`);
            embed.addFields({ name: '\u200b', value: summaryParts.join('\n') });

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Playerlist command error:', error.message);
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
