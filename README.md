# FSRP1 Discord Bot

A Discord bot for managing FSRP operations, including server session announcements, ER:LC integrations, automatic comms checks, and priority request workflows.

## Features

- Slash commands for session control (`/ssu`, `/ssd`, `/ssu-vote`, `/playerlist`, etc.)
- Guild setup command (`/setup`) for channels and roles
- ER:LC API integration for player checks and moderation actions
- Automatic in-game/comms enforcement loop
- Priority request message + modal workflow
- Command deployment script for one or more guilds

## Prerequisites

- Node.js 18+ (recommended)
- npm 9+
- PM2 (`npm i -g pm2`)
- A Discord application + bot token
- Discord server IDs where commands should be deployed
- ER:LC server API key (for ER:LC-dependent commands/features)

## 1) Install dependencies

```bash
npm install
```

## 2) Create `.env`

Create a `.env` file in the project root:

```env
# Required for bot login + slash command deployment
TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_application_id

# Guild targeting for command deployment and automation
MAIN_GUILD_ID=123456789012345678
LEO_GUILD_IDS=123456789012345678,234567890123456789
# Optional alternative format also supported:
# LEO_GUILD_1=123456789012345678
# LEO_GUILD_2=234567890123456789

# Required for ER:LC features
ERLC_API_KEY=your_erlc_server_key

# Optional (only if using UnbelievaBoat-related API logic)
UNBELIEVABOAT_API_KEY=your_unbelievaboat_api_key
```

## 3) Deploy slash commands

```bash
npm run deploy
```

This deploys command definitions to the guild IDs defined in your environment variables.

## 4) Run with PM2 (recommended)

Start the bot process with PM2:

```bash
pm2 start index.js --name fsrp1-bot
```

Useful PM2 commands:

```bash
pm2 status
pm2 logs fsrp1-bot --lines 100
pm2 restart fsrp1-bot
pm2 stop fsrp1-bot
pm2 delete fsrp1-bot
```

Enable startup on server reboot:

```bash
pm2 startup
pm2 save
```

## 5) First-time Discord setup

In your Discord server (as an admin):

```text
/setup ssu_channel:#channel ping_role:@role logs_channel:#logs priority_channel:#priority
```

If you run `/setup` with no options, it shows current config.

---

## Current Slash Commands

- `/setup` — configure SSU, ping role, logs, and priority channel
- `/ssu` — announce server startup/session start
- `/ssd` — announce server shutdown/session end
- `/ssu-vote` — start an SSU vote with a required threshold
- `/playerlist` — fetch or display player list data
- `/erlc` — ER:LC utility actions
- `/emoji` — emoji utility
- `/git` — utility/admin git actions
- `/hardcode manage` — manage automation bypass entries

---

## Suggested New Commands

1. `/health` — shows API and loop status.
2. `/config view` — returns current saved guild config.
3. `/config reset` — clears selected config values.
4. `/warnstatus <player>` — shows VC/comms warning counters.
5. `/role-sync now` — triggers one immediate role sync pass.
6. `/priority status` — shows current priority button status.
7. `/session note <text>` — logs a standardized staff session note.
8. `/help` — command index with usage examples.

---

## Troubleshooting

- **Commands not appearing**
  - Verify `TOKEN`, `CLIENT_ID`, and guild IDs.
  - Re-run `npm run deploy`.

- **Bot not staying online**
  - Check PM2 output: `pm2 logs fsrp1-bot --lines 100`.
  - Restart process: `pm2 restart fsrp1-bot`.

- **ER:LC commands failing**
  - Confirm `ERLC_API_KEY` is valid and API is reachable.

- **Priority message not sending in `/setup`**
  - Ensure bot has permission to send messages and use components in that channel.

- **Automation loop says guild not found**
  - Ensure `MAIN_GUILD_ID` matches a guild where the bot is present.

---

## Project Structure

```text
index.js
src/
  commands/        # Slash command modules
  events/          # Event handlers
  api/             # External API wrappers
  utils/           # Shared utility helpers
  deploy-commands.js
```
