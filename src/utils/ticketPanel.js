const {
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SectionBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    ThumbnailBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} = require('discord.js');

const BANNER_URL = 'https://imgur.com/a/ZXzR48e';
const LOGO_URL   = 'https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp';

const ACCENT = 0x4B5EFC;

function buildTicketPanelContainer() {
    return new ContainerBuilder()
        .setAccentColor(ACCENT)
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems([
                new MediaGalleryItemBuilder().setURL(BANNER_URL),
            ])
        )
        .addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(1)
        )
        .addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        '## Support\n' +
                        'In the support channel, you can reach out to us directly ' +
                        'about any inquiries that relate to our server.\n\n' +
                        'Press the button below to open a ticket and a member of our ' +
                        'staff team will assist you shortly.'
                    )
                )
                .setThumbnailAccessory(
                    new ThumbnailBuilder().setURL(LOGO_URL).setDescription('Florida State Roleplay')
                )
        )
        .addSeparatorComponents(
            new SeparatorBuilder().setDivider(false).setSpacing(1)
        )
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_open')
                    .setLabel('Open')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji({ id: '1491568422205526118', name: 'staff' })
            )
        );
}

module.exports = {
    buildTicketPanelContainer,
    TICKET_FLAGS: MessageFlags.IsComponentsV2,
};
