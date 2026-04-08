const {
    Events,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');

const hardcodeCommand = require('../commands/hardcode');
const staffRequestCommand = require('../commands/staffrequest');
const {
    handlePriorityRequestButton,
    handlePriorityApprove,
    handlePriorityDeny,
} = require('./priorityHandler');

const isHardcodeComponent = interaction => {
    if (!interaction.customId) return false;
    return interaction.customId.startsWith(`${hardcodeCommand.COMPONENT_PREFIX}:`);
};

const parseHardcodeId = customId => {
    const parts = customId.split(':');
    return {
        prefix: parts[0],
        action: parts[1],
        actorId: parts[2],
        page: Number(parts[3] || 0),
        messageId: parts[4],
    };
};

const ensureActor = async (interaction, actorId) => {
    if (!actorId || actorId === '0' || actorId === interaction.user.id) return true;

    await interaction.reply({
        content: 'Only the user who opened this list can use these controls. Run `/hardcode list` for your own controls.',
        flags: 64,
    });
    return false;
};

const updateHardcodeListMessage = async (targetInteraction, client, page, actorId) => {
    const bypasses = hardcodeCommand.getBypasses(client, targetInteraction.guild.id);
    const view = hardcodeCommand.buildListView(bypasses, page, actorId || targetInteraction.user.id);

    if (targetInteraction.isButton() || targetInteraction.isStringSelectMenu()) {
        await targetInteraction.update({ embeds: [view.embed], components: view.components });
        return;
    }

    if (targetInteraction.isModalSubmit()) {
        try {
            const messageId = targetInteraction.customId.split(':')[4];
            const message = await targetInteraction.channel.messages.fetch(messageId);
            if (message) {
                await message.edit({ embeds: [view.embed], components: view.components });
            }
        } catch (e) {
            console.warn('[Hardcode] Could not update original list message (it may have been deleted):', e.message);
        }
    }
};

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        // ── Button interactions ────────────────────────────────────────────────
        if (interaction.isButton()) {
            // Hardcode controls
            if (isHardcodeComponent(interaction)) {
                const parsed = parseHardcodeId(interaction.customId);
                if (!(await ensureActor(interaction, parsed.actorId))) return;

                if (parsed.action === 'prev') {
                    return updateHardcodeListMessage(interaction, client, parsed.page - 1, parsed.actorId);
                }
                if (parsed.action === 'next') {
                    return updateHardcodeListMessage(interaction, client, parsed.page + 1, parsed.actorId);
                }
                if (parsed.action === 'refresh') {
                    return updateHardcodeListMessage(interaction, client, parsed.page, parsed.actorId);
                }
                if (parsed.action === 'add_btn') {
                    const modal = new ModalBuilder()
                        .setCustomId(`${hardcodeCommand.COMPONENT_PREFIX}:add_modal:${parsed.actorId}:${parsed.page}:${interaction.message.id}`)
                        .setTitle('Add Hardcode Bypass Entry');

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('new_identifier')
                                .setLabel('Roblox Username or User ID')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                                .setPlaceholder('e.g. CoolRobloxUser or 123456789')
                                .setMaxLength(100)
                        )
                    );

                    return interaction.showModal(modal);
                }
            }

            // Staff request respond button
            if (interaction.customId === 'staffrequest_respond') {
                const reqData = staffRequestCommand.activeRequests.get(interaction.message.id);
                if (!reqData) {
                    return interaction.reply({ content: 'This staff request has expired.', flags: 64 });
                }

                const { respondees, playerCount, maxPlayers, joinUrl } = reqData;

                if (respondees.has(interaction.user.id)) {
                    respondees.delete(interaction.user.id);
                } else {
                    respondees.add(interaction.user.id);
                }

                const { buildRequestEmbed, buildRequestRow } = (() => {
                    const { EmbedBuilder: EB, ActionRowBuilder: ARB, ButtonBuilder: BB, ButtonStyle: BS } = require('discord.js');
                    const LOGO = 'https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp';
                    const FOOTER = 'https://i.postimg.cc/ZRqRj6bf/Untitled-design-(18).webp';

                    const buildEmbed = () => {
                        const respondeeList = respondees.size > 0
                            ? [...respondees].map(id => `• <@${id}>`).join('\n')
                            : '*No respondees yet.*';

                        return new EB()
                            .setTitle('Game Assistance')
                            .setColor('#5865F2')
                            .setThumbnail(LOGO)
                            .setDescription(
                                'We are in-need of in-game staff members to assist players with assistance, and to ensure that our server is maintained with a great roleplay experience.'
                            )
                            .addFields(
                                { name: '\u200b', value: `Players In-game: **${playerCount}/${maxPlayers}**`, inline: false },
                                { name: 'Respondees:', value: respondeeList, inline: false },
                            )
                            .setImage(FOOTER)
                            .setTimestamp();
                    };

                    const buildRow = () => new ARB().addComponents(
                        new BB()
                            .setCustomId('staffrequest_respond')
                            .setLabel('Respond')
                            .setStyle(BS.Secondary),
                        new BB()
                            .setLabel('Join In-Game')
                            .setStyle(BS.Link)
                            .setURL(joinUrl || 'https://www.roblox.com/games/2534724415'),
                    );

                    return { buildRequestEmbed: buildEmbed, buildRequestRow: buildRow };
                })();

                await interaction.update({
                    embeds: [buildRequestEmbed()],
                    components: [buildRequestRow()],
                });
                return;
            }

            // Priority — request button
            if (interaction.customId === 'priority_request') {
                return handlePriorityRequestButton(interaction, client);
            }

            // Priority — approve button
            if (interaction.customId.startsWith('priority_approve:')) {
                return handlePriorityApprove(interaction, client);
            }

            // Priority — deny button
            if (interaction.customId.startsWith('priority_deny:')) {
                return handlePriorityDeny(interaction, client);
            }

            // SSU vote buttons
            const ssuVoteCommand = client.commands.get('ssu-vote');
            const activeVotes = ssuVoteCommand?.activeVotes;
            const voteData = activeVotes?.get(interaction.message.id);

            if (!voteData) return;

            if (interaction.customId === 'vote_btn') {
                if (voteData.voters.has(interaction.user.id)) {
                    voteData.voters.delete(interaction.user.id);
                    console.log(`[Vote] ${interaction.user.tag} removed their vote (${voteData.voters.size}/${voteData.targetVotes})`);
                } else {
                    voteData.voters.add(interaction.user.id);
                    console.log(`[Vote] ${interaction.user.tag} voted (${voteData.voters.size}/${voteData.targetVotes})`);
                }

                const progressBar = ssuVoteCommand.buildProgressBar(voteData.voters.size, voteData.targetVotes, interaction.guild);

                const newLabel = `Vote (${voteData.voters.size}/${voteData.targetVotes})`;
                const voteBtn = new ButtonBuilder()
                    .setCustomId('vote_btn')
                    .setLabel(newLabel)
                    .setStyle(ButtonStyle.Success);

                const viewVotesBtn = new ButtonBuilder()
                    .setCustomId('view_votes_btn')
                    .setLabel('View Votes')
                    .setStyle(ButtonStyle.Primary);

                const embed = new EmbedBuilder()
                    .setTitle('Session Poll')
                    .setDescription(`We have now initiated a session vote. Please react below if you're willing to attend today's session. We require **${voteData.targetVotes}** votes to start a session.\n\n${progressBar}`)
                    .setColor('#5865F2')
                    .setImage('https://i.postimg.cc/59HmqpCR/INFormation.png');

                if (voteData.voters.size >= voteData.targetVotes) {
                    voteBtn.setDisabled(true);
                    voteBtn.setLabel(`Goal Reached! (${voteData.voters.size}/${voteData.targetVotes})`);

                    try {
                        const initiator = await client.users.fetch(voteData.initiatorId);
                        if (initiator) {
                            await initiator.send(`Your SSU Vote in **${interaction.guild.name}** has reached its goal of **${voteData.targetVotes}** votes!`);
                        }
                    } catch (e) {
                        console.log('[Vote] Could not DM initiator.');
                    }

                    activeVotes.delete(interaction.message.id);
                }

                const row = new ActionRowBuilder().addComponents(voteBtn, viewVotesBtn);
                await interaction.update({ embeds: [embed], components: [row] });

            } else if (interaction.customId === 'view_votes_btn') {
                const voterIds = Array.from(voteData.voters);

                const emojiBLine = interaction.guild.emojis.cache.find(e => e.name === 'BLine');
                const bLine = emojiBLine ? `${emojiBLine}`.repeat(10) : '';

                if (voterIds.length === 0) {
                    const embed = new EmbedBuilder()
                        .setTitle('Session Votes')
                        .setDescription(`No one has voted yet.${bLine ? '\n\n' + bLine : ''}`)
                        .setColor('#5865F2');
                    return interaction.reply({ embeds: [embed], flags: 64 });
                }

                const mentions = voterIds.map(id => `<@${id}>`).join('\n');
                const embed = new EmbedBuilder()
                    .setTitle('Session Votes')
                    .setDescription(`These are the people who voted. You can remove your vote by clicking Vote again.\n\n${mentions}${bLine ? '\n\n' + bLine : ''}`)
                    .setColor('#5865F2');

                await interaction.reply({ embeds: [embed], flags: 64 });
            }

            return;
        }

        // ── Select menu interactions ───────────────────────────────────────────
        if (interaction.isStringSelectMenu()) {
            // Hardcode select menus
            if (isHardcodeComponent(interaction)) {
                const parsed = parseHardcodeId(interaction.customId);
                if (!(await ensureActor(interaction, parsed.actorId))) return;

                const selectedIdentifier = interaction.values[0];
                if (!selectedIdentifier || selectedIdentifier === '__none__') {
                    return interaction.reply({ content: 'No identifier selected.', flags: 64 });
                }

                if (parsed.action === 'remove_select') {
                    const bypasses = hardcodeCommand.getBypasses(client, interaction.guild.id);
                    const nextBypasses = bypasses.filter(entry => entry !== selectedIdentifier);
                    hardcodeCommand.setBypasses(client, interaction.guild.id, nextBypasses);
                    await updateHardcodeListMessage(interaction, client, parsed.page, parsed.actorId);
                    return interaction.followUp({ content: `Removed \`${selectedIdentifier}\` from hardcode bypasses.`, flags: 64 });
                }

                if (parsed.action === 'edit_select') {
                    const modal = new ModalBuilder()
                        .setCustomId(`${hardcodeCommand.COMPONENT_PREFIX}:edit_modal:${parsed.actorId}:${parsed.page}:${interaction.message.id}`)
                        .setTitle('Edit Hardcode Identifier');

                    const oldIdentifierInput = new TextInputBuilder()
                        .setCustomId('old_identifier')
                        .setLabel('Old Identifier')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setValue(selectedIdentifier.slice(0, 100));

                    const newIdentifierInput = new TextInputBuilder()
                        .setCustomId('new_identifier')
                        .setLabel('New Identifier')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMaxLength(100);

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(oldIdentifierInput),
                        new ActionRowBuilder().addComponents(newIdentifierInput),
                    );

                    return interaction.showModal(modal);
                }
            }
        }

        // ── Modal submit interactions ──────────────────────────────────────────
        if (interaction.isModalSubmit() && isHardcodeComponent(interaction)) {
            const parsed = parseHardcodeId(interaction.customId);
            if (!(await ensureActor(interaction, parsed.actorId))) return;

            if (parsed.action === 'add_modal') {
                const identifier = interaction.fields.getTextInputValue('new_identifier').trim();
                const bypasses = hardcodeCommand.getBypasses(client, interaction.guild.id);

                if (bypasses.includes(identifier)) {
                    return interaction.reply({ content: `\`${identifier}\` is already in the bypass list.`, flags: 64 });
                }

                bypasses.push(identifier);
                hardcodeCommand.setBypasses(client, interaction.guild.id, bypasses);
                await updateHardcodeListMessage(interaction, client, parsed.page, parsed.actorId);
                return interaction.reply({ content: `Added \`${identifier}\` to hardcode bypasses.`, flags: 64 });
            }

            if (parsed.action === 'edit_modal') {
                const oldIdentifier = interaction.fields.getTextInputValue('old_identifier').trim();
                const newIdentifier = interaction.fields.getTextInputValue('new_identifier').trim();
                const bypasses = hardcodeCommand.getBypasses(client, interaction.guild.id);
                const oldIndex = bypasses.indexOf(oldIdentifier);

                if (oldIndex === -1) {
                    return interaction.reply({ content: `\`${oldIdentifier}\` was not found in hardcode bypasses.`, flags: 64 });
                }

                if (bypasses.includes(newIdentifier)) {
                    return interaction.reply({ content: `\`${newIdentifier}\` already exists in hardcode bypasses.`, flags: 64 });
                }

                bypasses[oldIndex] = newIdentifier;
                hardcodeCommand.setBypasses(client, interaction.guild.id, bypasses);
                await updateHardcodeListMessage(interaction, client, parsed.page, parsed.actorId);
                return interaction.reply({ content: `Updated \`${oldIdentifier}\` → \`${newIdentifier}\`.`, flags: 64 });
            }
        }
    },
};
