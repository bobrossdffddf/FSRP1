const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
} = require('discord.js');

const PAGE_SIZE = 10;
const COMPONENT_PREFIX = 'hc';

const getBypasses = (client, guildId) => client.settings.get(guildId, 'hardcodeBypasses') || [];

const setBypasses = (client, guildId, bypasses) => {
    client.settings.set(guildId, bypasses, 'hardcodeBypasses');
};

const buildListEmbed = (bypasses, page = 0) => {
    const totalPages = Math.max(1, Math.ceil(bypasses.length / PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const start = safePage * PAGE_SIZE;
    const current = bypasses.slice(start, start + PAGE_SIZE);

    const description = current.length
        ? current.map((id, i) => `\`${start + i + 1}.\` ${id}`).join('\n')
        : '_No hardcode bypass entries set._';

    const embed = new EmbedBuilder()
        .setTitle('⚙️ Hardcode Bypass Manager')
        .setColor(0x5865F2)
        .setDescription(description)
        .addFields({
            name: 'How it works',
            value: 'Players on this list are exempt from all automated kicks, jails, and warnings from the bot.',
        })
        .setFooter({ text: `Page ${safePage + 1}/${totalPages} · ${bypasses.length} total entr${bypasses.length === 1 ? 'y' : 'ies'}` });

    return { embed, safePage, totalPages, current };
};

const buildListComponents = (bypasses, page = 0, actorId = '0') => {
    const { safePage, totalPages, current } = buildListEmbed(bypasses, page);

    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${COMPONENT_PREFIX}:prev:${actorId}:${safePage}`)
            .setLabel('◀ Prev')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage <= 0),
        new ButtonBuilder()
            .setCustomId(`${COMPONENT_PREFIX}:next:${actorId}:${safePage}`)
            .setLabel('Next ▶')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage >= totalPages - 1),
        new ButtonBuilder()
            .setCustomId(`${COMPONENT_PREFIX}:refresh:${actorId}:${safePage}`)
            .setLabel('↻ Refresh')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`${COMPONENT_PREFIX}:add_btn:${actorId}:${safePage}`)
            .setLabel('+ Add Entry')
            .setStyle(ButtonStyle.Success),
    );

    const removeSelect = new StringSelectMenuBuilder()
        .setCustomId(`${COMPONENT_PREFIX}:remove_select:${actorId}:${safePage}`)
        .setPlaceholder(current.length ? 'Remove an entry…' : 'No entries to remove')
        .setMinValues(1)
        .setMaxValues(1)
        .setDisabled(!current.length)
        .addOptions(
            current.length
                ? current.map(id => ({ label: id.slice(0, 100), value: id, description: 'Remove this bypass' }))
                : [{ label: 'No entries', value: '__none__' }],
        );

    const editSelect = new StringSelectMenuBuilder()
        .setCustomId(`${COMPONENT_PREFIX}:edit_select:${actorId}:${safePage}`)
        .setPlaceholder(current.length ? 'Edit an entry…' : 'No entries to edit')
        .setMinValues(1)
        .setMaxValues(1)
        .setDisabled(!current.length)
        .addOptions(
            current.length
                ? current.map(id => ({ label: id.slice(0, 100), value: id, description: 'Edit this bypass' }))
                : [{ label: 'No entries', value: '__none__' }],
        );

    return [
        navRow,
        new ActionRowBuilder().addComponents(removeSelect),
        new ActionRowBuilder().addComponents(editSelect),
    ];
};

const buildListView = (bypasses, page = 0, actorId = '0') => {
    const { embed, safePage } = buildListEmbed(bypasses, page);
    const components = buildListComponents(bypasses, safePage, actorId);
    return { embed, components, page: safePage };
};

module.exports = {
    PAGE_SIZE,
    COMPONENT_PREFIX,
    getBypasses,
    setBypasses,
    buildListView,
    buildListComponents,
    buildListEmbed,

    data: new SlashCommandBuilder()
        .setName('hardcode')
        .setDescription('Manage hardcode bypass users')
        .setDefaultMemberPermissions(0n)
        .addSubcommand(sub =>
            sub
                .setName('manage')
                .setDescription('Open the hardcode bypass manager — add, remove, and edit entries interactively')
        ),

    async execute(interaction, client) {
        const guildId = interaction.guild.id;
        const bypasses = getBypasses(client, guildId);
        const view = buildListView(bypasses, 0, interaction.user.id);
        return interaction.reply({ embeds: [view.embed], components: view.components, flags: 64 });
    },
};
