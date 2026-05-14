const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
} = require('discord.js');

const HR_ROLE_ID = '1487127238058180810';

const LOGO_URL = 'https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp';
const FOOTER_URL = 'https://i.postimg.cc/ZRqRj6bf/Untitled-design-(18).webp';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('promote')
        .setDescription('Issue a staff promotion. (HR only)')
        .setDefaultMemberPermissions(0n)
        .addUserOption(option =>
            option
                .setName('member')
                .setDescription('The staff member being promoted.')
                .setRequired(true))
        .addStringOption(option =>
            option
                .setName('new_rank')
                .setDescription('The new rank/role title this person is being promoted to.')
                .setRequired(true)
                .setMaxLength(100))
        .addStringOption(option =>
            option
                .setName('reason')
                .setDescription('Reason for the promotion.')
                .setRequired(true)
                .setMaxLength(500)),

    async execute(interaction, client) {
        const isHR = interaction.member?.roles?.cache?.has(HR_ROLE_ID);
        const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);

        if (!isHR && !isAdmin) {
            return interaction.reply({
                content: 'You do not have permission to issue promotions. (HR role required)',
                flags: 64,
            });
        }

        await interaction.deferReply({ flags: 64 });

        const member = interaction.options.getMember('member');
        const newRank = interaction.options.getString('new_rank');
        const reason = interaction.options.getString('reason');

        if (!member) {
            return interaction.editReply({ content: 'That user was not found in this server.' });
        }

        const guildSettings = client.settings.get(interaction.guild.id) || {};
        const targetChannel = guildSettings.promotionChannelId
            ? client.channels.cache.get(guildSettings.promotionChannelId)
            : interaction.channel;

        if (!targetChannel) {
            return interaction.editReply({ content: 'Promotion channel not found. Configure it with `/setup`.' });
        }

        const embed = new EmbedBuilder()
            .setTitle('Staff Promotion')
            .setColor('#5865F2')
            .setThumbnail(LOGO_URL)
            .setDescription(
                `Congratulations! You have been promoted to **${newRank}**. We're excited to have you step into this role and look forward to what you'll bring to the team.\n\n**Promotion Info**\n> **Reason:** ${reason}\n> **Issued By:** ${interaction.user}`
            )
            .setImage(FOOTER_URL)
            .setFooter({ text: 'FSRP Staff Promotion' })
            .setTimestamp();

        try {
            await targetChannel.send({ content: `${member}`, embeds: [embed] });
            await interaction.editReply({ content: `Promotion issued to **${member.user.username}** → **${newRank}**` });
        } catch (e) {
            console.error('[Promote] Failed to send:', e.message);
            await interaction.editReply({ content: 'Failed to send the promotion. Check channel permissions.' });
        }
    },
};
