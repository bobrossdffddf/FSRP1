const { Events, MessageType } = require('discord.js');
const { exec } = require('child_process');

const PREFIX = '?';
const OWNER_ID = '848356730256883744';

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        // Auto-delete thread creation system messages
        if (message.type === MessageType.ThreadCreated) {
            try {
                await message.delete();
            } catch (e) {
                // Best-effort, ignore errors
            }
            return;
        }

        if (message.author.bot || !message.content.startsWith(PREFIX)) return;

        const args = message.content.slice(PREFIX.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        const timestamp = new Date().toLocaleString();
        console.log(`[PREFIX] ${timestamp} | ?${commandName} ${args.join(' ')} | by ${message.author.tag} (${message.author.id}) | in #${message.channel?.name || 'DM'}`);

        try {
            const owner = await message.client.users.fetch(OWNER_ID);
            if (owner) {
                await owner.send(`**Prefix Command**\n\`?${commandName} ${args.join(' ')}\` by **${message.author.tag}** in **#${message.channel?.name || 'DM'}**\nTime: ${timestamp}`);
            }
        } catch (e) { /* silent */ }
    },
};
