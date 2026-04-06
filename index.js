require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { setGlobalDispatcher, Agent } = require('undici');
const fs = require('fs');
const path = require('path');
const dns = require('dns');

dns.setDefaultResultOrder('ipv4first');

setGlobalDispatcher(new Agent({
    connect: { timeout: 60000 },
    headersTimeout: 60000,
    bodyTimeout: 60000
}));

const Enmap = require('enmap').default || require('enmap');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.commands = new Collection();
client.settings = new Enmap({ name: 'settings' });

// Stores raw Components V2 modal submit data keyed by userId.
// Populated by the 'raw' gateway event BEFORE discord.js parses it,
// so the priority handler can read User Select / Radio Group values.
client.rawModalData = new Map();

client.on('raw', (packet) => {
    if (packet.t !== 'INTERACTION_CREATE') return;
    const d = packet.d;
    if (d.type !== 5) return; // 5 = MODAL_SUBMIT
    if (d.data?.custom_id !== 'priority_form') return;
    const userId = d.user?.id ?? d.member?.user?.id;
    if (userId) {
        client.rawModalData.set(userId, d.data);
    }
});

// Load Commands
const commandsPath = path.join(__dirname, 'src', 'commands');
if (!fs.existsSync(commandsPath)) fs.mkdirSync(commandsPath, { recursive: true });
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

// Load Events
const eventsPath = path.join(__dirname, 'src', 'events');
if (!fs.existsSync(eventsPath)) fs.mkdirSync(eventsPath, { recursive: true });
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    if (!event.name) continue; // skip helper files like priorityHandler.js
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
    } else {
        client.on(event.name, (...args) => event.execute(...args, client));
    }
}

process.on('unhandledRejection', (reason, promise) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [UNHANDLED_REJECTION] Promise: ${promise}\nReason: ${reason}`);
});

process.on('uncaughtException', (error) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [UNCAUGHT_EXCEPTION] ${error.message}\n${error.stack}`);
});

client.on('error', (error) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [CLIENT_ERROR] ${error.message}\n${error.stack}`);
});

client.on('warn', (warning) => {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] [CLIENT_WARN] ${warning}`);
});

client.login(process.env.TOKEN);
