const {
    Events,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SectionBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    ThumbnailBuilder,
    MessageFlags,
} = require('discord.js');
const { updateMemberCountChannel } = require('../utils/serverVoiceChannels');
const { getAssetUrl } = require('../utils/assetServer');

const LOGO_URL = 'https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp';
const ACCENT   = 0xE6B300; // gold to match the tickets banner

function buildWelcomeContainer(member, departmentsChannelId) {
    const bannerUrl = getAssetUrl('banner.png');
    const footerUrl = getAssetUrl('footer.png');

    const container = new ContainerBuilder().setAccentColor(ACCENT);

    if (bannerUrl) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems([
                new MediaGalleryItemBuilder().setURL(bannerUrl),
            ])
        );
    }

    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(1)
    );

    const deptLine = departmentsChannelId
        ? `We're looking for department members! Join us in <#${departmentsChannelId}>.`
        : `We're looking for department members — check out the department channels.`;

    container.addSectionComponents(
        new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `## Welcome ${member} to Florida State Roleplay!\n${deptLine}`
                )
            )
            .setThumbnailAccessory(
                new ThumbnailBuilder().setURL(LOGO_URL).setDescription('Florida State Roleplay')
            )
    );

    if (footerUrl) {
        container.addSeparatorComponents(
            new SeparatorBuilder().setDivider(false).setSpacing(1)
        );
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems([
                new MediaGalleryItemBuilder().setURL(footerUrl),
            ])
        );
    }

    return container;
}

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member, client) {
        await updateMemberCountChannel(member.guild);

        try {
            const settings = client?.settings?.get(member.guild.id) || {};
            const welcomeChannelId = settings.welcomeChannelId;
            if (!welcomeChannelId) return;

            const channel = member.guild.channels.cache.get(welcomeChannelId)
                ?? await member.guild.channels.fetch(welcomeChannelId).catch(() => null);
            if (!channel) return;

            const container = buildWelcomeContainer(member, settings.departmentsChannelId);
            await channel.send({
                components: [container],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { users: [member.id] },
            });
        } catch (e) {
            console.warn('[Welcome] Failed to send welcome message:', e.message);
        }
    },
};
