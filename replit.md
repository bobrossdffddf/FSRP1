# FSRP Management Bot

A Discord bot built with discord.js that manages FSRP (Full Server Roleplay) operations, integrating with the ERLC (Emergency Response: Liberty County) API.

## Project Overview

This is a Discord bot ("larp-bot") that provides slash commands and event handling for managing staff, sessions, and player enforcement. It uses:
- **discord.js v14** for Discord API integration
- **enmap** for persistent key-value storage (server settings, infraction counter)
- **axios** for HTTP requests to ERLC API
- **dotenv** for environment variable management

## Architecture

- `index.js` - Entry point; loads commands/events and logs in the Discord client
- `src/commands/` - Slash command handlers:
  - `ssu.js` / `ssd.js` - Session start/stop announcements (sets sessionActive flag for shift monitor)
  - `ssu_vote.js` - Session vote system with buttons
  - `infraction.js` - `/infraction` — Staff infraction system (HR role only, auto-generates INF-XXXXXX IDs)
  - `promote.js` - `/promote` — Staff promotion embeds (HR role only)
  - `staffrequest.js` - `/staffrequest` — Game Assistance requests with Respond/Join buttons, pings Staff Team
  - `setup.js` - `/setup` (Admin only) — configures all channels (SSU, logs, priority, infraction, promotion, staffrequest, shift)
  - `erlc.js` - `/erlc` - run in-game ERLC server commands
  - `playerlist.js` - `/playerlist` - display server player list
  - `emoji.js` / `git.js` / `hardcode.js` - utility commands
- `src/events/` - Discord event handlers:
  - `automation.js` - Polls ERLC every 15s; manages In-Game role, VC comms enforcement
  - `shiftMonitor.js` - Polls mod calls every 60s; sends shift warnings/shoutouts every 5min when session is active
  - `interactionCreate.js` - Routes slash commands with permission checks
  - `interactionButton.js` - Handles all button interactions (staff request respond, priority, SSU vote, hardcode)
  - `priorityHandler.js` - Priority request workflow
  - `ready.js` - Initial bot setup
  - `memberAdd.js` / `memberRemove.js` / `messageCreate.js` - Other event handlers
- `src/api/erlc.js` - ERLC API wrapper (server info, players, mod calls, commands)
- `src/utils/` - Helper utilities (guildConfig, priorityMessage, announcementMessage, serverVoiceChannels)
- `src/deploy-commands.js` - Script to register guild-specific slash commands with Discord

## Staff System (New)

### `/infraction` (HR Role: 1487127238058180810 or Admin)
- Options: `member` (user), `punishment` (Warning/Strike/Demotion/Termination/Other), `reason`
- Auto-generates sequential Punishment IDs (INF-000001, INF-000002, …)
- Sends a red/colored embed to the configured `infractionChannelId`
- Counter is stored persistently in Enmap under key `__infraction_counter`

### `/promote` (HR Role or Admin)
- Options: `member` (user), `new_rank` (string), `reason`
- Sends a blue promotion embed to the configured `promotionChannelId`

### `/staffrequest` (Staff Team Role: 1487127237898666070, HR, or Admin)
- Fetches live player count from ERLC and sends a Game Assistance embed to `staffRequestChannelId`
- Pings @Staff Team role
- Includes **Respond** button (toggle — adds/removes user from respondees list, updates embed live)
- Includes **Join In-Game** link button (links to ERLC join URL using server's JoinKey)
- Active requests tracked in-memory (reset on bot restart)

### Shift Monitor (Automated)
- Activates when `/ssu` is run (sets `sessionActive: true`, `sessionStartTime`)
- Deactivates when `/ssd` is run (clears session data)
- Polls ERLC `/modcalls` endpoint every 60 seconds
- Tracks per-moderator handled calls (deduplicated by Caller+Timestamp key)
- Every 5 minutes evaluates each staff member's performance:
  - **Warning** (yellow embed) if < 60% of fair share
  - **Shoutout** (green embed) if > 130% of fair share
  - 15-minute cooldown per person to prevent spam
- Posts to configured `shiftChannelId`
- Tries to match Roblox username to Discord member by display name/nickname

## Key Role IDs
- `1487127237898666070` — Staff Team (can use `/staffrequest`)
- `1487127238058180810` — HR (can use `/infraction`, `/promote`)
- `1489733107006312558` — In-Game role (managed by automation)

## Required Secrets

Set these in the Secrets tab:

| Secret Key | Description |
|---|---|
| `TOKEN` | Discord bot token |
| `CLIENT_ID` | Discord application client ID |
| `ERLC_API_KEY` | ERLC (PRC) server API key |
| `MAIN_GUILD_ID` | Main server guild ID |
| `LEO_GUILD_IDS` | Comma-separated LEO guild IDs (optional) |

## Per-Server Configuration (via /setup, Admin only)

| Option | Stored Key | Description |
|---|---|---|
| `ssu_channel` | `ssuChannelId` | SSU/SSD announcements |
| `ping_role` | `pingRoleId` | Role pinged on SSU vote |
| `logs_channel` | `logsChannelId` | Bot command logs |
| `priority_channel` | `priorityChannelId` | Priority request button |
| `infraction_channel` | `infractionChannelId` | Staff infraction posts |
| `promotion_channel` | `promotionChannelId` | Staff promotion posts |
| `staffrequest_channel` | `staffRequestChannelId` | Game Assistance requests |
| `shift_channel` | `shiftChannelId` | Shift warnings/shoutouts |

## Running

The bot is started with `node index.js` via the "Start application" workflow.

To deploy slash commands to guilds: `node src/deploy-commands.js`
(Requires `CLIENT_ID`, `TOKEN`, and `MAIN_GUILD_ID` to be set.)

## Assets
- Logo: `https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp`
- Footer image: `https://i.postimg.cc/ZRqRj6bf/Untitled-design-(18).webp`
