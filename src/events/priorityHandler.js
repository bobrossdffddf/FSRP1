const {
    ChannelType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    Routes,
} = require('discord.js');
const { runCommand, getPlayers, getPlayerName } = require('../api/erlc');

const PRIORITY_ROLE_ID = '1487127238003396645';
const PRIORITY_BANNER_URL = 'https://i.postimg.cc/Bvh1B3Q5/INFormation-19.png'; // replace with your banner URL

const PRIORITY_LABELS = {
    evading: 'Evading LEO (Need 2+ players)',
    hostage: 'Hostage (Need 3+ players)',
    shootout: 'LEO Shootout',
    bank: 'Bank Robbery (Need 4+ players)',
};

/**
 * Called when the "Request a Priority" button is clicked.
 * Responds with a Components V2 modal (Radio Group + User Select + Text Input)
 * via raw REST since discord.js builders don't support these types yet.
 */
async function handlePriorityRequestButton(interaction) {
    // Use raw REST to send the modal response — discord.js ModalBuilder
    // doesn't support ComponentType 18 (Label), 21 (RadioGroup), or 5 (UserSelect) yet.
    await interaction.client.rest.post(
        Routes.interactionCallback(interaction.id, interaction.token),
        {
            body: {
                type: 9, // InteractionResponseType.Modal
                data: {
                    custom_id: 'priority_form',
                    title: 'Priority Request',
                    components: [
                        {
                            type: 18, // Label
                            label: 'Who is involved?',
                            description: 'Select all Discord members involved in this priority.',
                            component: {
                                type: 5, // UserSelect
                                custom_id: 'who_involved',
                                placeholder: 'Select players...',
                                min_values: 1,
                                max_values: 25,
                                required: true,
                            },
                        },
                        {
                            type: 18, // Label
                            label: 'What priority would you like?',
                            description: 'Select exactly one priority type.',
                            component: {
                                type: 21, // RadioGroup
                                custom_id: 'priority_type',
                                required: true,
                                options: [
                                    { value: 'evading', label: 'Evading LEO', description: 'Need 2+ players' },
                                    { value: 'hostage', label: 'Hostage', description: 'Need 3+ players' },
                                    { value: 'shootout', label: 'LEO Shootout' },
                                    { value: 'bank', label: 'Bank Robbery', description: 'Need 4+ players' },
                                ],
                            },
                        },
                        {
                            type: 1, // ActionRow (for the text input)
                            components: [
                                {
                                    type: 4, // TextInput
                                    custom_id: 'duration_seconds',
                                    label: 'How long? (in seconds, e.g. 15 min = 900)',
                                    style: 1, // Short
                                    required: true,
                                    placeholder: 'e.g. 900',
                                },
                            ],
                        },
                    ],
                },
            },
        }
    );
}

/**
 * Called when the priority_form modal is submitted.
 * Reads Components V2 data from client.rawModalData (captured via the raw WS event),
 * creates a private thread, PMs in-game mods, posts Approve/Deny buttons.
 */
async function handlePriorityModal(interaction, client) {
    await interaction.deferReply({ flags: 64 });

    // Retrieve the raw modal data captured before discord.js processed this interaction
    const rawData = client.rawModalData?.get(interaction.user.id);
    client.rawModalData?.delete(interaction.user.id);

    // --- Parse Components V2 fields from raw data ---
    let whoUserIds = [];
    let priorityType = null;

    if (rawData?.components) {
        for (const comp of rawData.components) {
            if (comp.type !== 18) continue; // Only process Label wrappers
            const inner = comp.component;
            if (!inner) continue;

            if (inner.type === 5 && inner.custom_id === 'who_involved') {
                // UserSelect — array of user ID strings
                whoUserIds = inner.values ?? [];
            }
            if (inner.type === 21 && inner.custom_id === 'priority_type') {
                // RadioGroup — single value string
                priorityType = inner.value ?? null;
            }
        }
    }

    // --- Parse standard text input (still in an ActionRow, discord.js handles it) ---
    let durationRaw = '';
    try {
        durationRaw = interaction.fields.getTextInputValue('duration_seconds').trim();
    } catch (_) {}

    // fallback: look in rawData components for ActionRow text inputs
    if (rawData?.components) {
        for (const comp of rawData.components) {
            if (comp.type === 1) {
                for (const sub of comp.components ?? []) {
                    if (sub.custom_id === 'duration_seconds' && !durationRaw) {
                        durationRaw = sub.value ?? '';
                    }
                }
            }
        }
    }

    const durationSecs = parseInt(durationRaw, 10);
    const validDuration = Number.isInteger(durationSecs) && durationSecs > 0;

    // --- Build "who is involved" display string ---
    const whoMentions = whoUserIds.length > 0
        ? whoUserIds.map(id => `<@${id}>`).join(', ')
        : '_Not specified_';

    const priorityLabel = PRIORITY_LABELS[priorityType] ?? priorityType ?? 'Unknown';

    const channel = interaction.channel;
    if (!channel) {
        return interaction.editReply({ content: 'Could not find the channel to create a thread in.' });
    }

    // --- Create private thread ---
    let thread;
    try {
        thread = await channel.threads.create({
            name: `Priority — ${priorityLabel} — ${interaction.user.username}`,
            type: ChannelType.PrivateThread,
            invitable: false,
            reason: 'Priority request',
        });
    } catch (e) {
        console.error('[Priority] Failed to create thread:', e.message);
        return interaction.editReply({
            content: 'Failed to create a priority thread. Make sure I have the **Create Private Threads** permission in that channel.',
        });
    }

    // Add the requester to the thread
    await thread.members.add(interaction.user.id).catch(() => {});

    // --- Build the thread embed ---
    const embed = new EmbedBuilder()
        .setTitle(`🚨 Priority Request — ${priorityLabel}`)
        .setColor(0xFF0000)
        .addFields(
            { name: 'Requested By', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Priority Type', value: priorityLabel, inline: true },
            { name: 'Who is Involved', value: whoMentions },
            {
                name: 'Requested Duration',
                value: validDuration ? `${durationSecs} seconds` : `⚠️ Invalid format provided: \`${durationRaw}\``,
            }
        )
        .setImage(PRIORITY_BANNER_URL)
        .setTimestamp();

    const approveBtn = new ButtonBuilder()
        .setCustomId(`priority_approve:${interaction.user.id}:${validDuration ? durationSecs : 0}`)
        .setLabel('Approve')
        .setStyle(ButtonStyle.Success);

    const denyBtn = new ButtonBuilder()
        .setCustomId(`priority_deny:${interaction.user.id}`)
        .setLabel('Deny')
        .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(approveBtn, denyBtn);

    await thread.send({
        content: `<@&${PRIORITY_ROLE_ID}> A new priority request has been submitted.`,
        embeds: [embed],
        components: [row],
    });

    // --- Delete the "thread created" system message in the parent channel ---
    try {
        // Discord creates a system message with the same ID as the thread
        const systemMsg = await channel.messages.fetch(thread.id).catch(() => null);
        if (systemMsg) await systemMsg.delete();
    } catch (_) {
        // Best-effort — ignore if already gone or no permission
    }

    // --- PM all in-game moderators (those with priority role whose Roblox name is in their display name) ---
    try {
        const guild = interaction.guild;
        const inGamePlayers = await getPlayers();

        if (Array.isArray(inGamePlayers) && inGamePlayers.length > 0) {
            const modMembers = guild.members.cache.filter(m => m.roles.cache.has(PRIORITY_ROLE_ID));

            for (const player of inGamePlayers) {
                const robloxName = getPlayerName(player.Player);
                const robloxLower = robloxName.toLowerCase();

                const isMod = modMembers.some(m => {
                    const nick = (m.nickname ?? '').toLowerCase();
                    const globalName = (m.user.globalName ?? '').toLowerCase();
                    const uname = (m.user.username ?? '').toLowerCase();
                    return nick.includes(robloxLower) || globalName.includes(robloxLower) || uname.includes(robloxLower);
                });

                if (isMod) {
                    await runCommand(`:pm ${robloxName} [PRIORITY REQUEST] ${priorityLabel} has been requested. Check your Discord.`);
                }
            }
        }
    } catch (e) {
        console.error('[Priority] Failed to PM in-game mods:', e.message);
    }

    await interaction.editReply({
        content: `Your priority request has been submitted. A moderator will review it in the thread shortly.`,
    });
}

/**
 * Called when the Approve button is clicked in the priority thread.
 */
async function handlePriorityApprove(interaction, client) {
    await interaction.deferUpdate();

    const parts = interaction.customId.split(':');
    const requesterId = parts[1];
    const durationSecs = parseInt(parts[2], 10);
    const validDuration = Number.isInteger(durationSecs) && durationSecs > 0;

    let erlcSuccess = false;
    if (validDuration) {
        try {
            const result = await runCommand(`:prty ${durationSecs}`);
            erlcSuccess = result !== null;
        } catch (e) {
            console.error('[Priority] Failed to run :prty:', e.message);
        }
    }

    const approvedEmbed = new EmbedBuilder()
        .setTitle('✅ Priority Approved')
        .setColor(0x57F287)
        .addFields(
            { name: 'Approved By', value: `<@${interaction.user.id}>`, inline: true },
            {
                name: 'ERLC Command',
                value: erlcSuccess
                    ? `\`:prty ${durationSecs}\` sent successfully.`
                    : `⚠️ Could not run \`:prty\` automatically. <@&${PRIORITY_ROLE_ID}> please run it manually.`,
            }
        )
        .setTimestamp();

    await interaction.message.edit({
        embeds: [...interaction.message.embeds, approvedEmbed],
        components: [],
    });

    if (!erlcSuccess) {
        await interaction.message.channel.send({
            content: `<@&${PRIORITY_ROLE_ID}> Please run \`:prty ${durationSecs > 0 ? durationSecs : '<duration>'}\` manually — the automatic command failed.`,
        });
    }

    try {
        const requester = await client.users.fetch(requesterId);
        await requester.send(
            'Your priority has been approved! You will see the message in game shortly, please abide by all of the rules.'
        );
    } catch (e) {
        console.error('[Priority] Could not DM requester after approval:', e.message);
    }
}

/**
 * Called when the Deny button is clicked in the priority thread.
 */
async function handlePriorityDeny(interaction, client) {
    await interaction.deferUpdate();

    const requesterId = interaction.customId.split(':')[1];

    const deniedEmbed = new EmbedBuilder()
        .setTitle('❌ Priority Denied')
        .setColor(0xED4245)
        .addFields({ name: 'Denied By', value: `<@${interaction.user.id}>`, inline: true })
        .setTimestamp();

    await interaction.message.edit({
        embeds: [...interaction.message.embeds, deniedEmbed],
        components: [],
    });

    try {
        const requester = await client.users.fetch(requesterId);
        await requester.send(
            'Your priority request has been denied. If you have any questions, please reach out to a moderator.'
        );
    } catch (e) {
        console.error('[Priority] Could not DM requester after denial:', e.message);
    }
}

module.exports = {
    handlePriorityRequestButton,
    handlePriorityModal,
    handlePriorityApprove,
    handlePriorityDeny,
};
