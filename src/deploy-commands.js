const { REST, Routes } = require('discord.js');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getLeoGuildIds, getMainGuildId } = require('./utils/guildConfig');

const commandsPath = path.join(__dirname, 'commands');
const loadedCommands = [];

if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const command = require(`./commands/${file}`);
        if ('data' in command && 'execute' in command) {
            loadedCommands.push(command);
        } else {
            console.log(`[WARNING] The command at ${file} is missing "data" or "execute".`);
        }
    }
}

const rest = new REST().setToken(process.env.TOKEN);

(async () => {
    try {
        const leoGuildIds = getLeoGuildIds();
        const mainGuildId = getMainGuildId();

        if (leoGuildIds.length === 0 && !mainGuildId) {
            throw new Error('No guild targets configured. Set MAIN_GUILD_ID and/or LEO_GUILD_IDS.');
        }

        const allCommandsJson = loadedCommands.map(cmd => cmd.data.toJSON());

        const targetGuilds = [...new Set([...leoGuildIds, ...(mainGuildId ? [mainGuildId] : [])])];

        for (const guildId of targetGuilds) {
            console.log(`Deploying ${allCommandsJson.length} commands to guild ${guildId}: ${allCommandsJson.map(c => c.name).join(', ')}`);

            let deployed;
            try {
                deployed = await rest.put(
                    Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
                    { body: allCommandsJson }
                );
            } catch (deployErr) {
                console.warn(`Skipping guild ${guildId} — could not deploy: ${deployErr.message}`);
                continue;
            }

            console.log(`Done: guild ${guildId} — ${deployed.length} commands deployed`);

            // Set role-based permissions: allow role 1488210128187560169 to see all commands
            // and keep admin access on setup/git
            try {
                const STAFF_ROLE_ID = '1488210128187560169';

                const commandPermissions = deployed.map(cmd => ({
                    id: cmd.id,
                    permissions: [
                        {
                            id: STAFF_ROLE_ID,
                            type: 1, // role
                            permission: true,
                        }
                    ],
                }));

                await rest.put(
                    Routes.guildApplicationCommandsPermissions(process.env.CLIENT_ID, guildId),
                    { body: commandPermissions }
                );

                console.log(`Set role permissions for guild ${guildId}`);
            } catch (permErr) {
                console.warn(`Could not set permissions for guild ${guildId}: ${permErr.message}`);
                console.warn('You may need to manually configure command permissions in Server Settings > Integrations.');
            }
        }

        console.log('Command deployment completed.');
    } catch (error) {
        console.error(error);
    }
})();
