/**
 * Ticket Panel — builds the panel embed and button row sent to the ticket panel channel.
 * Original design: deep-space indigo with clean lines and a bold support aesthetic.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function buildTicketPanelEmbed() {
    return new EmbedBuilder()
        .setColor(0x1A1F6E)
        .setTitle('╔══════════════════════════════════╗\n          S U P P O R T   D E S K\n╚══════════════════════════════════╝')
        .setDescription(
            '> Our staff team is standing by to assist you.\n' +
            '> Whether it\'s a gameplay concern, a community question,\n' +
            '> or anything else — we\'re here for you.\n\n' +
            '**How to open a ticket:**\n' +
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
            '`1.` Click the button below\n' +
            '`2.` Describe your issue briefly\n' +
            '`3.` A staff member will assist you shortly\n' +
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
            '*Please do not open duplicate tickets or abuse the system.*'
        )
        .setThumbnail('https://i.imgur.com/4M34hi2.png')
        .setFooter({ text: 'Support Desk  •  Average response time: < 15 minutes' })
        .setTimestamp();
}

function buildTicketPanelRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ticket_open')
            .setLabel('Open a Ticket')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎫'),
    );
}

module.exports = { buildTicketPanelEmbed, buildTicketPanelRow };
