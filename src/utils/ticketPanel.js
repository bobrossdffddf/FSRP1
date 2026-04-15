const {
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SectionBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    ThumbnailBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    MessageFlags,
} = require('discord.js');
const { getAssetUrl } = require('./assetServer');

const LOGO_URL = 'https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp';
const ACCENT   = 0x4B5EFC;

function buildTicketPanelContainer() {
    const bannerUrl = getAssetUrl('banner.png');

    const container = new ContainerBuilder().setAccentColor(ACCENT);

    if (bannerUrl) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems([
                new MediaGalleryItemBuilder().setURL(bannerUrl),
            ])
        );
    }

    container
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
                new StringSelectMenuBuilder()
                    .setCustomId('ticket_type_select')
                    .setPlaceholder('Select a ticket type...')
                    .addOptions(
                        new StringSelectMenuOptionBuilder()
                            .setLabel('General Support')
                            .setDescription('Open a general support ticket with our staff team')
                            .setValue('general_support')
                            .setEmoji({ id: '1491568422205526118', name: 'staff' }),
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Staff Report')
                            .setDescription('Submit a formal report regarding a staff member or player')
                            .setValue('staff_report')
                            .setEmoji({ id: '1489218432850464768', name: 'warning' }),
                    )
            )
        );

    return container;
}

function buildTicketPanelFiles() {
    return [];
}

module.exports = {
    buildTicketPanelContainer,
    buildTicketPanelFiles,
    TICKET_FLAGS: MessageFlags.IsComponentsV2,
};
