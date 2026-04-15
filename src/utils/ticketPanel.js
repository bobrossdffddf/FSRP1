const fs   = require('fs');
const path = require('path');
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
    AttachmentBuilder,
    MessageFlags,
} = require('discord.js');

const BANNER_PATH       = path.join(__dirname, '../../assets/banner.png');
const LOGO_URL          = 'https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp';
const BANNER_ATTACH_URL = 'attachment://banner.png';

const ACCENT = 0x4B5EFC;

let _bannerBuffer = null;

function getPanelBannerBuffer() {
    if (_bannerBuffer === null) {
        try {
            if (fs.existsSync(BANNER_PATH)) {
                _bannerBuffer = fs.readFileSync(BANNER_PATH);
            } else {
                _bannerBuffer = false;
            }
        } catch {
            _bannerBuffer = false;
        }
    }
    return _bannerBuffer;
}

function buildTicketPanelContainer() {
    const bannerBuf = getPanelBannerBuffer();

    const container = new ContainerBuilder().setAccentColor(ACCENT);

    if (bannerBuf) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems([
                new MediaGalleryItemBuilder().setURL(BANNER_ATTACH_URL),
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
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Internal Affairs')
                            .setDescription('Submit a confidential Internal Affairs report')
                            .setValue('internal_affairs')
                            .setEmoji({ id: '1491568422205526118', name: 'staff' }),
                    )
            )
        );

    return container;
}

function buildTicketPanelFiles() {
    const bannerBuf = getPanelBannerBuffer();
    return bannerBuf ? [new AttachmentBuilder(bannerBuf, { name: 'banner.png' })] : [];
}

module.exports = {
    buildTicketPanelContainer,
    buildTicketPanelFiles,
    TICKET_FLAGS: MessageFlags.IsComponentsV2,
};
