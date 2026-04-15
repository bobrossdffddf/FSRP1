const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const BANNER_URL = 'https://i.postimg.cc/59HmqpCR/INFormation.png';
const LOGO_URL   = 'https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp';
const FOOTER_URL = 'https://i.postimg.cc/ZRqRj6bf/Untitled-design-(18).webp';

function buildTicketPanelEmbeds() {
    const bannerEmbed = new EmbedBuilder()
        .setImage(BANNER_URL);

    const contentEmbed = new EmbedBuilder()
        .setColor(0x4B5EFC)
        .setAuthor({ name: 'Florida State Roleplay', iconURL: LOGO_URL })
        .setTitle('Support')
        .setDescription(
            'In the support channel, you can reach out to us directly about any inquiries that relate to our server.\n\n' +
            'Press the button below to open a ticket and a member of our staff team will assist you shortly.'
        )
        .setImage(FOOTER_URL)
        .setTimestamp();

    return [bannerEmbed, contentEmbed];
}

function buildTicketPanelRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ticket_open')
            .setLabel('Open')
            .setStyle(ButtonStyle.Secondary)
    );
}

module.exports = { buildTicketPanelEmbeds, buildTicketPanelRow };
