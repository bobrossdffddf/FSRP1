# LARP Bot

A Discord bot built with discord.js that integrates with the ERLC (Emergency Response: Liberty County) API and UnbelievaBoat economy API.

## Project Overview

This is a Discord bot ("larp-bot") that provides slash commands and event handling for managing ERLC server interactions, police citations, and server sessions. It uses:
- **discord.js v14** for Discord API integration
- **enmap** for persistent key-value storage (server settings, citations)
- **axios** for HTTP requests to ERLC and UnbelievaBoat APIs
- **dotenv** for environment variable management

## Architecture

- `index.js` - Entry point; loads commands/events and logs in the Discord client
- `src/commands/` - Slash command handlers:
  - `citation.js` - `/citation create` (LEO guilds) and `/citation lookup` (main guild)
  - `setup.js` - `/setup` (LEO guilds, admin only) — configures citation roles, logs channel, and economy guild
  - `erlc.js` - `/erlc` - run in-game ERLC server commands
  - `playerlist.js` - `/playerlist` - display server player list
  - `ssu.js` / `ssd.js` - session start/stop announcements
  - `ssu_vote.js` - session vote system
  - `emoji.js` / `git.js` / `hardcode.js` - utility commands
- `src/events/` - Discord event handlers (ready, interactionCreate, interactionButton, messageCreate, automation)
- `src/api/erlc.js` - ERLC API wrapper (server info, players, commands)
- `src/api/unbelievaboat.js` - UnbelievaBoat API wrapper (get balance, edit balance)
- `src/utils/guildConfig.js` - Helper to resolve LEO guild IDs and main guild ID from env vars
- `src/deploy-commands.js` - Script to register guild-specific slash commands with Discord

## Citation System

Citations are guild-specific:
- `/citation create` is deployed **only to LEO guilds** (DPS, CHP, etc.)
- `/citation lookup` is deployed **only to the main guild**
- `/setup` is deployed **only to LEO guilds**

### Citation Flow
1. Officer runs `/citation create <discord_user_id>` in a LEO guild
2. A modal form opens asking for: violation name (with penal code), event description, vehicle description, person description, and fine amount
3. On submission the bot deducts the fine from the target's cash balance in the main server's UnbelievaBoat economy
4. A citation embed is posted to the configured citation logs channel
5. The citation is stored persistently and is searchable via `/citation lookup` in the main guild

Fine cap: **$10,000,000**

## Required Secrets

Set these in the Secrets tab (they are never stored in code):

| Secret Key | Description |
|---|---|
| `TOKEN` | Discord bot token |
| `CLIENT_ID` | Discord application client ID |
| `ERLC_API_KEY` | ERLC (PRC) server API key |
| `UNBELIEVABOAT_API_KEY` | UnbelievaBoat API key — used to deduct citation fines from economy |
| `MAIN_GUILD_ID` | Main server guild ID (where `/citation lookup` is deployed and where fines are deducted from by default) |
| `LEO_GUILD_IDS` | Comma-separated guild IDs of your LEO servers (e.g. `123456789,987654321`) — `/citation create` and `/setup` deploy here |

### Alternative to LEO_GUILD_IDS
Instead of `LEO_GUILD_IDS`, you can set individual variables:
- `LEO_GUILD_1` = first LEO guild ID
- `LEO_GUILD_2` = second LEO guild ID
- etc.

## Per-Server Configuration (via /setup)

Each LEO server must be configured by an admin using `/setup`:

| Option | Description |
|---|---|
| `citation_logs` | Channel where citation embeds are posted after each ticket |
| `citation_roles` | Comma-separated role IDs allowed to issue citations |
| `citation_economy_guild_id` | The main server guild ID where UnbelievaBoat fines are charged (defaults to MAIN_GUILD_ID behavior) |
| `ssu_channel` | Channel for SSU/SSD session announcements |
| `ping_role` | Role pinged when SSU vote starts |
| `logs_channel` | Channel for general bot command logs |

## Running

The bot is started with `node index.js` and runs as a console workflow.

To deploy slash commands to guilds, run: `node src/deploy-commands.js`
(Requires `MAIN_GUILD_ID` and/or `LEO_GUILD_IDS` to be set first.)
