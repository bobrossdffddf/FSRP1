const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
} = require('discord.js');

const PRIORITY_ROLE_ID = '1487127238003396645';
const PRIORITY_BANNER_URL = 'https://i.postimg.cc/Bvh1B3Q5/INFormation-19.png'; // replace with your banner image URL

function buildPriorityEmbed(disabled = false) {
    return new EmbedBuilder()
        .setTitle('LARP Server Management')
        .setColor(disabled ? 0x2C2F33 : 0xFF0000)
        .setDescription(
            disabled
                ? 'Priority requests are currently **closed** while the server is shut down. They will reopen on the next Server Start Up.'
                : '# Request a Priority\n Click the button below to submit your request — a moderator will approve or deny it.'
        )
        .addFields({
            name: 'Available Priorities',
            value: '• **Evading LEO** — 2+ players\n• **Hostage** — 3+ players\n• **LEO Shootout**\n• **Bank Robbery** — 4+ players',
        })
        .setImage(PRIORITY_BANNER_URL)
        .setFooter({ text: disabled ? 'Priorities are closed — SSD active' : 'Florida State Roleplay' })
        .setTimestamp();
}

function buildPriorityRow(disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('priority_request')
            .setLabel(disabled ? 'Priorities Closed' : 'Request a Priority')
            .setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Danger)
            .setDisabled(disabled)
    );
}

/**
 * Update the stored priority button message to enabled or disabled state.
 * Silently no-ops if the message ID or channel isn't found.
 */
async function setPriorityButtonState(client, guildId, disabled) {
    const settings = client.settings.get(guildId) || {};
    const { priorityChannelId, priorityMessageId } = settings;
    if (!priorityChannelId || !priorityMessageId) return;

    try {
        const channel = await client.channels.fetch(priorityChannelId).catch(() => null);
        if (!channel) return;

        const message = await channel.messages.fetch(priorityMessageId).catch(() => null);
        if (!message) return;

        await message.edit({
            embeds: [buildPriorityEmbed(disabled)],
            components: [buildPriorityRow(disabled)],
        });
    } catch (e) {
        console.error(`[PriorityMessage] Failed to update button state (disabled=${disabled}):`, e.message);
    }
}

module.exports = {
    buildPriorityEmbed,
    buildPriorityRow,
    setPriorityButtonState,
    PRIORITY_ROLE_ID,
};
