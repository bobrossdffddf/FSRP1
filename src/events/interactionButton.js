const {
    Events,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    LabelBuilder,
    UserSelectMenuBuilder,
    FileUploadBuilder,
    PermissionFlagsBits,
} = require('discord.js');

const hardcodeCommand = require('../commands/hardcode');
const staffRequestCommand = require('../commands/staffrequest');
const infractionCommand = require('../commands/infraction');
const {
    handlePriorityRequestButton,
    handlePriorityApprove,
    handlePriorityDeny,
} = require('./priorityHandler');
const { activeFlags, consecutiveBadScans } = require('./shiftMonitor');
const { getTicketData, setTicketData } = require('../utils/ticketManager');
const { buildUpdatedContainer, getTicketAttachments, CV2_FLAG } = require('./ticketActions');
const { closeTicket } = require('../commands/close');

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
            // ── Ticket: Open (show modal) ─────────────────────────────────────
            if (interaction.customId === 'ticket_open') {
                const modal = new ModalBuilder()
                    .setCustomId('ticket_open_modal')
                    .setTitle('Open a Support Ticket');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('ticket_reason')
                            .setLabel('What do you need help with?')
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(true)
                            .setMaxLength(500)
                            .setPlaceholder('Briefly describe your issue or question...')
                    )
                );

                return interaction.showModal(modal);
            }

            // ── Ticket: Claim ─────────────────────────────────────────────────
            if (interaction.customId.startsWith('ticket_claim:')) {
                const channelId = interaction.customId.split(':')[1];
                const ticket    = getTicketData(client, channelId);

                if (!ticket) return interaction.reply({ content: 'Ticket data not found.', flags: 64 });
                if (ticket.claimedBy) {
                    return interaction.reply({ content: `This ticket is already claimed by <@${ticket.claimedBy}>.`, flags: 64 });
                }

                const settings      = client.settings.get(interaction.guild.id) || {};
                const supportRoleId = settings.ticketSupportRoleId;
                const hasRole       = supportRoleId ? interaction.member.roles.cache.has(supportRoleId) : false;
                const isAdmin       = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

                if (!hasRole && !isAdmin) {
                    return interaction.reply({ content: 'Only support staff can claim tickets.', flags: 64 });
                }

                setTicketData(client, channelId, { claimedBy: interaction.user.id });
                const freshTicket = getTicketData(client, channelId);

                await interaction.deferUpdate();

                if (freshTicket.ticketMessageId) {
                    const msg = await interaction.channel.messages.fetch(freshTicket.ticketMessageId).catch(() => null);
                    if (msg) {
                        const { files, hasBanner, hasFooter } = getTicketAttachments();
                        const container = buildUpdatedContainer(freshTicket, true, `${interaction.user}`, { hasBanner, hasFooter });
                        await msg.edit({ components: [container], files, flags: CV2_FLAG }).catch(e => console.warn('[Claim] edit failed:', e.message));
                    }
                }
                return;
            }

            // ── Ticket: Unclaim ───────────────────────────────────────────────
            if (interaction.customId.startsWith('ticket_unclaim:')) {
                const channelId = interaction.customId.split(':')[1];
                const ticket    = getTicketData(client, channelId);

                if (!ticket) return interaction.reply({ content: 'Ticket data not found.', flags: 64 });
                if (ticket.claimedBy !== interaction.user.id) {
                    return interaction.reply({ content: 'You are not the one who claimed this ticket.', flags: 64 });
                }

                setTicketData(client, channelId, { claimedBy: null });
                const freshTicket = getTicketData(client, channelId);

                await interaction.deferUpdate();

                if (freshTicket.ticketMessageId) {
                    const msg = await interaction.channel.messages.fetch(freshTicket.ticketMessageId).catch(() => null);
                    if (msg) {
                        const { files, hasBanner, hasFooter } = getTicketAttachments();
                        const container = buildUpdatedContainer(freshTicket, false, null, { hasBanner, hasFooter });
                        await msg.edit({ components: [container], files, flags: CV2_FLAG }).catch(e => console.warn('[Unclaim] edit failed:', e.message));
                    }
                }
                return;
            }

            // ── Ticket: Force Close ───────────────────────────────────────────
            if (interaction.customId.startsWith('ticket_close_force:')) {
                const channelId = interaction.customId.split(':')[1];
                const ticket    = getTicketData(client, channelId);

                if (!ticket) return interaction.reply({ content: 'Ticket data not found.', flags: 64 });

                const settings      = client.settings.get(interaction.guild.id) || {};
                const supportRoleId = settings.ticketSupportRoleId;
                const hasRole       = supportRoleId ? interaction.member.roles.cache.has(supportRoleId) : false;
                const isAdmin       = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
                const isCreator     = interaction.user.id === ticket.creatorId;

                if (!hasRole && !isAdmin && !isCreator) {
                    return interaction.reply({ content: 'Only support staff or the ticket creator can close this ticket.', flags: 64 });
                }

                await interaction.deferReply({ flags: 64 });

                const closingEmbed = new EmbedBuilder()
                    .setColor(0xED4245)
                    .setDescription(`This ticket is being closed by ${interaction.user}. Generating transcript...`);

                await interaction.channel.send({ embeds: [closingEmbed] }).catch(() => {});
                await closeTicket(interaction.channel, ticket, interaction.user, client);
                return;
            }

            // ── Ticket: Accept Close Request ──────────────────────────────────
            if (interaction.customId.startsWith('ticket_close_accept:')) {
                const channelId = interaction.customId.split(':')[1];
                const ticket    = getTicketData(client, channelId);

                if (!ticket) return interaction.reply({ content: 'Ticket data not found.', flags: 64 });
                if (interaction.user.id !== ticket.creatorId) {
                    return interaction.reply({ content: 'Only the ticket creator can accept this close request.', flags: 64 });
                }

                await interaction.deferReply({ flags: 64 });

                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('_accepted').setLabel('Accepted').setStyle(ButtonStyle.Danger).setDisabled(true)
                );

                await interaction.message.edit({ components: [disabledRow] }).catch(() => {});

                const closingEmbed = new EmbedBuilder()
                    .setColor(0xED4245)
                    .setDescription(`Close request accepted. Generating transcript...`);
                await interaction.channel.send({ embeds: [closingEmbed] }).catch(() => {});

                await closeTicket(interaction.channel, ticket, interaction.user, client);
                return;
            }

            // ── Ticket: Decline Close Request ─────────────────────────────────
            if (interaction.customId.startsWith('ticket_close_decline:')) {
                const channelId = interaction.customId.split(':')[1];
                const ticket    = getTicketData(client, channelId);

                if (!ticket) return interaction.reply({ content: 'Ticket data not found.', flags: 64 });
                if (interaction.user.id !== ticket.creatorId) {
                    return interaction.reply({ content: 'Only the ticket creator can decline this close request.', flags: 64 });
                }

                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('_declined').setLabel('Declined').setStyle(ButtonStyle.Secondary).setDisabled(true)
                );

                await interaction.update({ components: [disabledRow] });
                await interaction.channel.send({
                    embeds: [new EmbedBuilder().setColor(0xFEE75C).setDescription(`Close request declined by ${interaction.user}.`)]
                });
                return;
            }

            // ── Infraction interaction guard ───────────────────────────────────
            if (interaction.customId.startsWith('inf_')) {
                const { PermissionFlagsBits } = require('discord.js');
                const MANAGE_ROLE_ID = infractionCommand.MANAGE_ROLE_ID;
                const hasRole = interaction.member?.roles?.cache?.has(MANAGE_ROLE_ID);
                const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
                if (!hasRole && !isAdmin) {
                    return interaction.reply({ content: 'You do not have permission to use infraction controls.', flags: 64 });
                }

                // Helper: fetch target member quietly
                const fetchTarget = async (userId) => {
                    try { return await interaction.guild.members.fetch(userId); } catch { return null; }
                };

                // ── Resolve ────────────────────────────────────────────────────
                if (interaction.customId.startsWith('inf_resolve:')) {
                    const parts  = interaction.customId.split(':');
                    const infId  = parts[1];
                    const userId = parts[2];

                    const infractions = client.settings.get(`user_infractions_${userId}`) || [];
                    const idx = infractions.findIndex(i => i.id === infId);
                    if (idx === -1) return interaction.reply({ content: `Case \`${infId}\` not found.`, flags: 64 });
                    if (!infractions[idx].active) return interaction.reply({ content: `\`${infId}\` is already resolved.`, flags: 64 });

                    infractions[idx].active     = false;
                    infractions[idx].resolvedBy = interaction.user.id;
                    infractions[idx].resolvedAt = Math.floor(Date.now() / 1000);
                    client.settings.set(`user_infractions_${userId}`, infractions);
                    console.log(`[Infraction] ${infId} resolved by ${interaction.user.username}`);

                    const target      = await fetchTarget(userId);
                    const displayName = target?.displayName ?? `User ${userId}`;
                    const avatarURL   = target?.user?.displayAvatarURL({ dynamic: true });
                    const inf         = infractions[idx];
                    const { embed, components } = infractionCommand.buildCaseEmbed(inf, userId, displayName, avatarURL);
                    embed.setFooter({ text: `Resolved by ${interaction.user.username}` });
                    return interaction.update({ embeds: [embed], components });
                }

                // ── Back to list ───────────────────────────────────────────────
                if (interaction.customId.startsWith('inf_back:')) {
                    const userId      = interaction.customId.split(':')[1];
                    const target      = await fetchTarget(userId);
                    const displayName = target?.displayName ?? `User ${userId}`;
                    const avatarURL   = target?.user?.displayAvatarURL({ dynamic: true });
                    const infractions = client.settings.get(`user_infractions_${userId}`) || [];
                    const { embed, components } = infractionCommand.buildListEmbed(userId, displayName, avatarURL, infractions);
                    embed.setFooter({ text: `Opened by ${interaction.user.username}` });
                    return interaction.update({ embeds: [embed], components });
                }

                // ── Edit (open modal) ──────────────────────────────────────────
                if (interaction.customId.startsWith('inf_edit:')) {
                    const parts  = interaction.customId.split(':');
                    const infId  = parts[1];
                    const userId = parts[2];

                    const infractions = client.settings.get(`user_infractions_${userId}`) || [];
                    const inf = infractions.find(i => i.id === infId);
                    if (!inf) return interaction.reply({ content: `Case \`${infId}\` not found.`, flags: 64 });

                    const modal = new ModalBuilder()
                        .setCustomId(`inf_edit_modal:${infId}:${userId}`)
                        .setTitle(`Edit Case ${infId}`);

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('punishment')
                                .setLabel('Punishment Type')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                                .setValue(inf.punishment)
                                .setPlaceholder('Warning, Strike, Demotion, Termination, Other')
                                .setMaxLength(20),
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('reason')
                                .setLabel('Reason')
                                .setStyle(TextInputStyle.Paragraph)
                                .setRequired(true)
                                .setValue((inf.reason || '').slice(0, 1000))
                                .setMaxLength(1000),
                        ),
                    );

                    return interaction.showModal(modal);
                }
            }

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

            // ── Shift Contribution Flag — Resolve ────────────────────────────
            if (interaction.customId.startsWith('scflag_resolve:')) {
                const HR_ROLE_ID   = '1487127238058180810';
                const isHR         = interaction.member?.roles?.cache?.has(HR_ROLE_ID);
                const isAdmin      = interaction.member?.permissions?.has(0x8n);

                if (!isHR && !isAdmin) {
                    return interaction.reply({
                        content: 'Only HR members can resolve Shift Contribution Flags.',
                        flags: 64,
                    });
                }

                const modName = interaction.customId.slice('scflag_resolve:'.length);

                // Reset consecutive scan count so they get a clean slate
                consecutiveBadScans.delete(modName);
                activeFlags.delete(modName);

                // Edit the original flag message to mark it resolved
                try {
                    const targetMsg = interaction.message;
                    const oldEmbed  = targetMsg.embeds[0];

                    const resolvedEmbed = EmbedBuilder.from(oldEmbed)
                        .setColor('#5865F2')
                        .setFooter({ text: `Resolved by ${interaction.user.username}` })
                        .setTimestamp();

                    await interaction.update({
                        embeds:     [resolvedEmbed],
                        components: [],
                    });
                } catch (e) {
                    console.warn('[ShiftMonitor] Could not update flag message on resolve:', e.message);
                    await interaction.reply({
                        content: `Flag for **${modName}** has been resolved by ${interaction.user}.`,
                        flags: 64,
                    });
                }

                console.log(`[ShiftMonitor] Flag resolved for ${modName} by ${interaction.user.tag}`);
                return;
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
            // ── Ticket type select (panel dropdown) ────────────────────────────
            if (interaction.customId === 'ticket_type_select') {
                const selected = interaction.values[0];

                if (selected === 'general_support') {
                    const modal = new ModalBuilder()
                        .setCustomId('ticket_open_modal')
                        .setTitle('Open a Support Ticket');

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('ticket_reason')
                                .setLabel('What do you need help with?')
                                .setStyle(TextInputStyle.Paragraph)
                                .setRequired(true)
                                .setMaxLength(500)
                                .setPlaceholder('Briefly describe your issue or question...')
                        )
                    );

                    return interaction.showModal(modal);
                }

                if (selected === 'internal_affairs') {
                    const modal = new ModalBuilder()
                        .setCustomId('ia_ticket_modal')
                        .setTitle('Internal Affairs Submission');

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('ia_reason')
                                .setLabel('What is this IA report regarding?')
                                .setStyle(TextInputStyle.Paragraph)
                                .setRequired(true)
                                .setMinLength(10)
                                .setMaxLength(500)
                                .setPlaceholder('Briefly describe the nature of your Internal Affairs report...')
                        )
                    );

                    return interaction.showModal(modal);
                }

                if (selected === 'staff_report') {
                    const modal = new ModalBuilder()
                        .setCustomId('staff_report_modal')
                        .setTitle('Staff Report Submission');

                    modal.addComponents(
                        new LabelBuilder()
                            .setLabel('Incident Description')
                            .setTextInputComponent(
                                new TextInputBuilder()
                                    .setCustomId('report_description')
                                    .setStyle(TextInputStyle.Paragraph)
                                    .setRequired(true)
                                    .setMinLength(20)
                                    .setMaxLength(1000)
                                    .setPlaceholder('Describe what happened, including what occurred and the circumstances.')
                            ),
                        new LabelBuilder()
                            .setLabel('Reported Individual')
                            .setUserSelectMenuComponent(
                                new UserSelectMenuBuilder()
                                    .setCustomId('reported_user')
                                    .setRequired(true)
                                    .setMaxValues(1)
                                    .setPlaceholder('Select the individual being reported')
                            ),
                        new LabelBuilder()
                            .setLabel('Supporting Evidence (Optional)')
                            .setFileUploadComponent(
                                new FileUploadBuilder()
                                    .setCustomId('evidence_files')
                                    .setRequired(false)
                            ),
                        new LabelBuilder()
                            .setLabel('Video or Clip URL (Optional)')
                            .setTextInputComponent(
                                new TextInputBuilder()
                                    .setCustomId('clip_url')
                                    .setStyle(TextInputStyle.Short)
                                    .setRequired(false)
                                    .setMaxLength(500)
                                    .setPlaceholder('https://...')
                            ),
                    );

                    return interaction.showModal(modal);
                }

                return;
            }

            // ── Infraction case select ─────────────────────────────────────────
            if (interaction.customId.startsWith('inf_select:')) {
                const { PermissionFlagsBits } = require('discord.js');
                const MANAGE_ROLE_ID = infractionCommand.MANAGE_ROLE_ID;
                const hasRole = interaction.member?.roles?.cache?.has(MANAGE_ROLE_ID);
                const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
                if (!hasRole && !isAdmin) {
                    return interaction.reply({ content: 'You do not have permission to use infraction controls.', flags: 64 });
                }

                const userId      = interaction.customId.split(':')[1];
                const selectedId  = interaction.values[0];
                const infractions = client.settings.get(`user_infractions_${userId}`) || [];
                const inf         = infractions.find(i => i.id === selectedId);

                if (!inf) return interaction.reply({ content: `Case \`${selectedId}\` not found.`, flags: 64 });

                let target;
                try { target = await interaction.guild.members.fetch(userId); } catch { /* ok */ }
                const displayName = target?.displayName ?? `User ${userId}`;
                const avatarURL   = target?.user?.displayAvatarURL({ dynamic: true });

                const { embed, components } = infractionCommand.buildCaseEmbed(inf, userId, displayName, avatarURL);
                embed.setFooter({ text: `Opened by ${interaction.user.username}` });
                return interaction.update({ embeds: [embed], components });
            }

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
        // ── Infraction edit modal ──────────────────────────────────────────────
        if (interaction.isModalSubmit() && interaction.customId.startsWith('inf_edit_modal:')) {
            const { PermissionFlagsBits } = require('discord.js');
            const MANAGE_ROLE_ID = infractionCommand.MANAGE_ROLE_ID;
            const hasRole = interaction.member?.roles?.cache?.has(MANAGE_ROLE_ID);
            const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
            if (!hasRole && !isAdmin) {
                return interaction.reply({ content: 'You do not have permission to edit infractions.', flags: 64 });
            }

            const parts      = interaction.customId.split(':');
            const infId      = parts[1];
            const userId     = parts[2];
            const infractions = client.settings.get(`user_infractions_${userId}`) || [];
            const idx         = infractions.findIndex(i => i.id === infId);

            if (idx === -1) return interaction.reply({ content: `Case \`${infId}\` not found.`, flags: 64 });

            const VALID_PUNISHMENTS = ['Warning', 'Strike', 'Demotion', 'Termination', 'Other'];
            const rawPunishment = interaction.fields.getTextInputValue('punishment').trim();
            const newPunishment = VALID_PUNISHMENTS.find(p => p.toLowerCase() === rawPunishment.toLowerCase());

            if (!newPunishment) {
                return interaction.reply({
                    content: `Invalid punishment type. Must be one of: ${VALID_PUNISHMENTS.join(', ')}`,
                    flags: 64,
                });
            }

            const newReason = interaction.fields.getTextInputValue('reason').trim();
            infractions[idx].punishment = newPunishment;
            infractions[idx].reason     = newReason;
            infractions[idx].editedBy   = interaction.user.id;
            infractions[idx].editedAt   = Math.floor(Date.now() / 1000);
            client.settings.set(`user_infractions_${userId}`, infractions);
            console.log(`[Infraction] ${infId} edited by ${interaction.user.username} — ${newPunishment}`);

            let target;
            try { target = await interaction.guild.members.fetch(userId); } catch { /* ok */ }
            const displayName = target?.displayName ?? `User ${userId}`;
            const avatarURL   = target?.user?.displayAvatarURL({ dynamic: true });
            const inf         = infractions[idx];
            const { embed, components } = infractionCommand.buildCaseEmbed(inf, userId, displayName, avatarURL);
            embed.setFooter({ text: `Edited by ${interaction.user.username}` });

            return interaction.update({ embeds: [embed], components });
        }

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
