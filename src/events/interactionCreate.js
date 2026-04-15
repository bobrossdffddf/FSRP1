const { Events, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getMainGuildId } = require('../utils/guildConfig');

const OWNER_ID = '848356730256883744';
const REQUIRED_ROLE_ID = '1488210128187560169';
const OWNER_ONLY_COMMANDS = ['git'];
const SELF_PERMISSIONED_COMMANDS = ['setup', 'infraction', 'promote', 'staffrequest', 'statlookup', 'my-infractions', 'escalate', 'rename', 'close', 'ticket'];

const log = (level, command, message) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] [CMD:${command}] ${message}`);
};

const buildLogEmbed = (interaction, options) => {
    const user = interaction.user;
    const channel = interaction.channel;

    const embed = new EmbedBuilder()
        .setTitle('Command Log')
        .setColor('#5865F2')
        .addFields(
            { name: 'Command', value: `\`/${interaction.commandName}\``, inline: true },
            { name: 'User', value: `${user} (${user.username})`, inline: true },
            { name: 'Channel', value: `${channel || 'DM'}`, inline: true },
            { name: 'Server', value: interaction.guild?.name || 'DM', inline: true }
        )
        .setTimestamp();

    if (options !== 'none') {
        embed.addFields({ name: 'Options', value: `\`${options}\`` });
    }

    return embed;
};

const queueCommandTelemetry = (interaction, client, options, timestamp) => {
    const user = interaction.user;
    const channel = interaction.channel;

    client.users.fetch(OWNER_ID)
        .then(owner => owner?.send(`**Command Run**\n\`/${interaction.commandName}\` by **${user.username}** in **#${channel?.name || 'DM'}** (${interaction.guild?.name || 'DM'})\nOptions: ${options}\nTime: ${timestamp}`))
        .catch(e => log('WARN', interaction.commandName, `Failed to send owner DM: ${e.message}`));

    const logEmbed = buildLogEmbed(interaction, options);

    const guildSettings = client.settings.get(interaction.guild?.id);
    if (guildSettings?.logsChannelId) {
        const localLogsChannel = client.channels.cache.get(guildSettings.logsChannelId);
        if (localLogsChannel) {
            localLogsChannel.send({ embeds: [logEmbed] })
                .catch(e => log('WARN', interaction.commandName, `Failed to log to local channel: ${e.message}`));
        }
    }

    const mainGuildId = getMainGuildId();
    if (mainGuildId && mainGuildId !== interaction.guild?.id) {
        const mainSettings = client.settings.get(mainGuildId);
        if (mainSettings?.logsChannelId) {
            const mainLogsChannel = client.channels.cache.get(mainSettings.logsChannelId);
            if (mainLogsChannel) {
                mainLogsChannel.send({ embeds: [logEmbed] })
                    .catch(e => log('WARN', interaction.commandName, `Failed to log to main guild channel: ${e.message}`));
            }
        }
    }
};

const sendSafeReply = async (interaction, content, flags = 64) => {
    try {
        if (!interaction.isRepliable()) {
            log('WARN', interaction.commandName || 'unknown', 'Interaction is not repliable');
            return;
        }

        if (interaction.replied) {
            await interaction.followUp({ content, flags });
        } else if (interaction.deferred) {
            await interaction.editReply({ content });
        } else {
            await interaction.reply({ content, flags });
        }
    } catch (error) {
        if (error.code === 10062) {
            log('ERROR', interaction.commandName || 'unknown', `Interaction expired: ${error.message}`);
        } else {
            log('ERROR', interaction.commandName || 'unknown', `Failed to send reply: ${error.message}`);
        }
    }
};

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        try {
            if (!interaction.isChatInputCommand() && !interaction.isModalSubmit()) return;

            if (interaction.isModalSubmit()) {
                if (interaction.customId === 'priority_form') {
                    const { handlePriorityModal } = require('./priorityHandler');
                    await handlePriorityModal(interaction, client);
                    return;
                }

                if (interaction.customId === 'ticket_open_modal') {
                    const { createTicket } = require('./ticketActions');
                    const reason = interaction.fields.getTextInputValue('ticket_reason');

                    await interaction.deferReply({ flags: 64 });

                    const ticketChannel = await createTicket(interaction, client, reason);
                    if (!ticketChannel) {
                        return interaction.editReply({
                            content: 'Failed to create your ticket. Please make sure the bot has permission to manage channels and try again.',
                        });
                    }

                    return interaction.editReply({
                        content: `Your ticket has been opened in ${ticketChannel}. Our staff team will be with you shortly.`,
                    });
                }

                if (interaction.customId === 'staff_report_modal') {
                    const { createStaffReportTicket } = require('./ticketActions');

                    const description = interaction.fields.getTextInputValue('report_description');

                    // Reported user (UserSelect — required)
                    const selectedUsers = interaction.fields.getSelectedUsers('reported_user', true);
                    const reportedUserId = selectedUsers?.firstKey();
                    if (!reportedUserId) {
                        return interaction.reply({
                            content: 'No user was selected. Please try again and select the individual being reported.',
                            flags: 64,
                        });
                    }

                    // Optional: uploaded evidence files
                    let evidenceFiles = null;
                    try {
                        evidenceFiles = interaction.fields.getUploadedFiles('evidence_files', false);
                    } catch { /* field not present or empty */ }

                    // Optional: clip/video URL
                    let clipUrl = '';
                    try {
                        clipUrl = (interaction.fields.getTextInputValue('clip_url') ?? '').trim();
                    } catch { /* field not present or empty */ }

                    await interaction.deferReply({ flags: 64 });

                    const ticketChannel = await createStaffReportTicket(interaction, client, {
                        description,
                        reportedUserId,
                        evidenceFiles,
                        clipUrl,
                    });

                    if (!ticketChannel) {
                        return interaction.editReply({
                            content: 'Failed to create your report. Please make sure the bot has permission to manage channels and try again.',
                        });
                    }

                    return interaction.editReply({
                        content: `Your staff report has been submitted in ${ticketChannel}. A member of our team will review it shortly.`,
                    });
                }

                return;
            }

            if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);
                const timestamp = new Date().toLocaleString();
                const user = interaction.user;
                const channel = interaction.channel;
                const options = interaction.options.data.map(o => `${o.name}:${o.value}`).join(', ') || 'none';

                const isOwnerOnlyCommand = OWNER_ONLY_COMMANDS.includes(interaction.commandName);
                const isSelfPermissioned = SELF_PERMISSIONED_COMMANDS.includes(interaction.commandName);

                try {
                    if (isOwnerOnlyCommand) {
                        if (interaction.user.id !== OWNER_ID) {
                            log('WARN', interaction.commandName, `Permission denied for ${user.username} (${user.id}) - owner-only`);
                            return await sendSafeReply(interaction, 'Only the bot owner can use this command.');
                        }
                    } else if (!isSelfPermissioned) {
                        const hasRequiredRole = interaction.member && interaction.member.roles.cache.has(REQUIRED_ROLE_ID);
                        const isAdmin = interaction.member && interaction.member.permissions.has(PermissionFlagsBits.Administrator);

                        if (!hasRequiredRole && !isAdmin) {
                            log('WARN', interaction.commandName, `Permission denied for ${user.username} (${user.id}) - missing role`);
                            return await sendSafeReply(interaction, `You do not have permission to use this command.`);
                        }
                    }
                } catch (permError) {
                    log('ERROR', interaction.commandName, `Permission check failed: ${permError.message}`);
                    return await sendSafeReply(interaction, 'An error occurred while checking permissions.');
                }

                if (!command) {
                    log('ERROR', interaction.commandName, 'Command not found');
                    return;
                }

                log('INFO', interaction.commandName, `Executed by ${user.username} (${user.id}) in #${channel?.name || 'DM'} [${interaction.guild?.name}] | options: ${options}`);

                queueCommandTelemetry(interaction, client, options, timestamp);

                try {
                    await command.execute(interaction, client);
                } catch (error) {
                    log('ERROR', interaction.commandName, `Execution failed: ${error.message}\n${error.stack}`);
                    await sendSafeReply(interaction, 'There was an error while executing this command!');
                }
            }
        } catch (error) {
            log('ERROR', 'InteractionCreate', `Unhandled error: ${error.message}\n${error.stack}`);
        }
    },
};
