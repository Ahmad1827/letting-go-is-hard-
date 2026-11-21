# Letting Go Is Hard

A 2D pixel-art workspace for AI agents, set in a 1990s office on the 88th floor
of the World Trade Center. Every agent is an employee: you see what it's doing by
where it walks, and it comes to your desk when it needs permission.

It's a desktop app (Electron).

```
npm install
npm run dev          # opens the app window with hot reload
npm start            # builds and runs the app
npm run dist:win     # Windows build: release/Letting Go Is Hard-<version>-win.zip
npm run dist:linux   # Linux AppImage
```

`npm run dist:win-installer` makes a Setup .exe, but it must be run on Windows
(or on Linux with Wine installed).

## How agents work

New hires sit **idle** until you give them something to do: message them, or tick
**Come up with ideas** in their panel (or type `/ideas on` in their terminal). Ticked,
they loop through the cycle below on their own, but only once you've left them with nothing
to do for 5 minutes (change it under *Settings → Pitches*); a message from you in that time
puts them to work on that instead.

Looking for an idea is kept cheap: it runs on Haiku by default (*Settings → Pitches*), in a
lean session with no MCP servers, subagents or web searches, and the agent is handed a summary
of every project so it reads a few files instead of exploring. Approved work runs on the
agent's own model with everything. Unticked, they stop looking for ideas and go back to idle
once their current job is done.

1. **Research**: looks through the folders in `~/proiecte` (in the conference room and the archive).
2. **Queue**: walks to the line outside Ahmad's office. One pitches at a time, three
   wait at the door, the rest wait at their desks.
3. **Pitch**: stands at Ahmad's desk. The idea and its plan show in their terminal (and the
   team's), Claude Code style, and in the *Office* panel. You can:
   - **Approve** (1 in the terminal): they go and do it, on its own branch.
   - **Don't approve** (2): they go back to idle, and pitch something else only after
     another stretch with nothing to do.
   - **Tell them what to do instead** (type it in their terminal, or in the pitch card): they work out which project you mean, or start a new one, and get going
     without pitching again.
4. **Work**: types at their desk, runs things at the mainframe, and asks before risky
   commands (the *OKs* panel), then drops the result in the mail room outbox.
5. **Afterwards**: they still remember the job. Ask "are you finished?" or "what did you
   change?" any time later and they answer from that job's own conversation (a manager can
   even hand out more of it to the team). Ask for something new and they start on that instead.
   A plain question to someone with nothing on just gets an answer, not a pitch.

*Auto-approve (let go)* approves pitches and commands without asking.

### Teams

*New team...* groups people you've hired: one **manager** and any number of **workers**.
Give the team a task, or leave it empty and, if you give them nothing for a few minutes,
the manager researches and pitches an idea big enough for the team. Once the work starts:

- The manager plans it and hands each worker a piece.
- Each worker builds on their own branch, started from the team's branch, and reports
  back when done. Workers wait at their desks between tasks.
- The manager reviews their work, merges it into the team branch, runs the checks, and
  tells you it's done. Then the manager goes looking for the team's next idea if their
  *Come up with ideas* box is ticked, or waits idle if not.

*Disband* sends everyone back to working on their own.

Roles are quick to change:

- **Staff list:** each person has a role picker: *Solo*, *Manager* or *Worker* of any team,
  or *Manager · new team*.
- **Any terminal:** just say it, e.g. `Dana you're the manager, Bob and Sam are workers`,
  `make Kim a worker`, `Lee is on his own now`, or `Dana manager, the rest workers`. In
  someone's own terminal `you` means them (`u are manager`). Or use `/role Dana manager`,
  and `/teams` to see who's where. A new manager takes over their team and the old one stays
  on as a worker; a manager going solo breaks the team up. Anything that isn't only about
  roles is sent to the agent as a normal message.

In the desktop app every employee is a real **Claude Code** session: the `claude` CLI
installed on this machine, using its existing login (no API key). Electron's main process
runs one headless session per agent (`electron/agents.mjs`) and the office answers its
permission prompts:

- Agents get everything Claude Code has in a terminal: every built-in tool, every installed
  skill, and the MCP servers set up on this machine (e.g. a Blender server). Only moving
  between worktrees is left to the office.
- While researching, agents may only read. Anything that would change a file is refused.
- Approved work happens in a git worktree under `~/proiecte/.letting-go/worktrees/` on the
  agent's own branch, so your checkout is never touched. Agents commit there and never push.
  A project without git history gets edited in place, and every change asks first.
- Commands that need permission show up in the *OKs* panel.
- **Questions:** when something is your call, agents ask with multiple choice (Claude Code's
  AskUserQuestion). It shows in their terminal: press a number, or type your own answer.
- **Apps and the screen:** agents can start programs to test their work (the app they're
  building, Blender, a browser) and look at the screen: the app runs a small screenshot
  server on 127.0.0.1 (`electron/screen.mjs`), and each agent is told its address and key.
- **Missing skills:** if a task needs a skill that isn't installed, the agent looks through the
  plugin marketplaces and asks you to install it (it shows in the terminal and the OKs panel).
  Say yes and the office installs the plugin and restarts the agent with it loaded, in the same
  conversation.

**Pictures:** paste (Ctrl+V) or drop pictures into an agent's message box, the "do this
instead" box on a pitch, or a new team's task. They go to Claude along with your words.

**Music:** lo-fi office music plays in the background, generated live in the app (no audio
files). Turn it off or change the volume in the *Music* panel; it remembers your choice.

The *Usage* tab carries a small meter for your plan's 5-hour window; its panel shows every
window (5-hour, weekly), when they reset, and how many tokens each agent has used. The
numbers come live from Claude every minute, the same ones Claude Code's `/usage` shows,
using Claude Code's saved login (`electron/usage.mjs`).

**Auto mode:** approved work runs in Claude Code's auto mode, so agents decide what's safe
on their own and only genuinely risky actions ask. Switch to "ask me" in Settings, or to
**Full access** (Claude Code's bypass permissions: nothing is checked or asked, deleting
files included).

**Closing with work in progress:** the app asks whether to let agents finish in the
background. If yes, the window hides, each agent finishes only the job you already approved,
nobody starts anything new, and the app quits by itself when everyone is done. In auto mode
or full access they carry on just as they would with you there; in "ask me" mode anything
needing approval is allowed inside their branch folder and refused elsewhere. Questions and
plugin installs can't wait for you, so they decide for themselves and say so in their
summary. Open the app again to bring the window back.

**Settings** (the gear on the right): your projects folder, your AI engines, which engine and model new
hires use, approvals, and what closing does. An engine is any Claude Code-compatible command
plus environment variables and a model list. Claude Code is built in; point it at another
LLM with `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN`, or another account with
`CLAUDE_CONFIG_DIR`.

**Work Board:** click the corkboard in Ahmad's office (or *Board* on the right) to see everyone, grouped by team, with where they are in the cycle, what they're
doing, the project and branch, and how long they've been at it.

**Hold:** every card on the board has *Hold*, and every team *Hold team*. Held agents stop
where they are and keep their job, branch and conversation until you *Reopen* them; then
they pick up exactly where they stopped. Messages for them (yours, or a worker's report to
a held manager) wait until they're back. Holds survive closing the app.

Click an agent to see their full log, switch their model (Fable 5.1, Opus 5.5, Sonnet 5.5,
Haiku 5.5, older versions, or Claude Code's default), stop them, message them, or fire them.

**Terminals:** click a character (or the `>_` next to them in Staff) to open their terminal,
which looks and works like Claude Code: their replies, tool calls and results scroll by, you
type at the `❯` prompt (Enter sends, Shift+Enter for a new line, Esc interrupts, ↑ for
earlier messages, Ctrl+V for pictures), and permission questions are answered right there
with 1 or 2. `/help` lists the commands (`/clear`, `/stop`, `/hold`, `/reopen`, `/model`).
Click a team's name in Staff (or its `>_ Team`) for the team's terminal: everyone's lines
together, tagged by name. A message there goes to the whole team and the manager decides
what happens; start with `@Name` for one person. Teammates talk to each other too (a
```` ```tell ```` block the office delivers), but the manager has the final say. Windows can be
dragged, resized and minimized, and the history is kept between runs.

**Terminal view** (the `>_` icon in the top bar, or **T**): the office as nothing but
terminals, all in one grid, groups and people alike. Drag one to move it (the order is kept);
click one to zoom in and work in it. Esc (with an empty prompt), `[esc] all` or Ctrl + scroll
down zooms back out, Ctrl + scroll up over a terminal zooms into it. The numbered tabs along
the top jump straight to any terminal (Alt + its number) and flag the ones waiting on you, a
pitch included; the line along the bottom counts who's busy and what's waiting. `[+] new
group` puts agents together.

**Themes:** the whole app follows one theme: the terminals, the office's panels, and the
view out of the office window. *normal* (Claude Code dark, the city at night), *purple*
(Windows Terminal's Ubuntu colours, at dusk), *night* (deep blue, lights low), *light*
(Claude Code light, in daylight) and *retro* (Windows 95 panels and cmd.exe terminals, in
daylight). Each has its own pixel picture in the terminals' welcome box: a sun behind a
cloud, a sunset, the moon, the sun, a floppy disk. Pick one in *Settings → Theme*, with the
theme button in the terminal view, or with `/theme` in any terminal.

**Commands** in any terminal: `/model`, `/status`, `/cost`, `/skills`, `/engine`, `/stop`,
`/hold`, `/reopen`, `/ideas`, `/approve`, `/pass`, `/theme`, `/clear`, `/help`. In a group
terminal each person answers on their own line, and `@Name /model ...` runs it for one
person. Anything else starting with `/` goes to Claude Code itself (e.g. `/compact`, or a
skill).

**Skills:** every agent can use every skill installed on your machine, and picks what fits
the task. The Skills button on an agent marks their go-to skills, which they reach for first
(tick "Give new hires these skills too" to make them the default); they show as tags on the
agent's panel. A change applies from their next job.

In a plain browser (`npx vite`) the agents are simulated instead (`src/agents/sim.ts`).

**Staff are remembered.** Close the app and open it again and everyone is back at their
desk, with their model, team, full log and usage, and they continue their own Claude Code
conversation (`--resume`), so they remember what was said and done. Whoever was in the
middle of an approved job picks it back up on the same branch, whoever was waiting to pitch
gets back in line, and the rest carry on researching (or stay idle). People only leave when you **Fire** them (in their
panel, with a confirmation): they stop, walk to the elevator and go, their desk frees up,
and their branches stay. The office is saved in `office.json` in the app's data folder
(an office that suddenly goes empty keeps the previous one in `office.bak.json`).

**Screen:** the office fills the window. The tabs down the right edge (Staff, Office, OKs,
Agent, Usage, Music) slide their panels out over the floor and back; a badge on *Office*
counts who's waiting to pitch and *OKs* counts commands waiting for you. Zoom is in the
bottom-left corner. Open panels are remembered too.

`LETTING_GO_PROJECTS=/some/folder npm run dev` points the agents at another projects folder,
and `CLAUDE_BIN` picks a different `claude` executable.

People only go to two places, so they're easy to keep track of: **their own PC**, and
**Ahmad's office** when they have something to pitch. Everything else shows at their desk:

| Agent activity | At their PC |
|---|---|
| thinking, talking, standby | sits at the desk, desktop on screen |
| reading, writing | types, code scrolls on the CRT |
| running | types, a progress bar on the CRT |
| awaiting | sits with a red "!" bubble and an alert on screen until you answer |
| done | a check-mark bubble; the finished work lands in the mail room outbox |
| idle | screensaver |
| queued | waits in line outside Ahmad's door (the first three), or at the desk |
| pitching | stands at Ahmad's desk |

Outside it's always night: the 1990s skyline with lit windows, across the river.

Closing the window turns the lights off room by room (Ahmad's office last), leaves the
CRTs glowing, and says goodbye before the app quits. Running agents are stopped first.

## Layout

- `electron/main.mjs`: the desktop window.
- `electron/agents.mjs`: runs one headless Claude Code session per agent and prepares worktrees.
- `electron/settings.mjs`: saved settings and AI engines.
- `electron/skills.mjs`: lists an engine's installed skills and limits an agent to the picked ones.
- `electron/projects.mjs`, `electron/preload.cjs`: read-only scan of the projects folder, exposed to the page.
- `scripts/dev.mjs`: starts Vite and opens Electron on it.
- `src/agents/types.ts`: the `AgentEvent` contract. Anything that emits these can drive the office.
- `src/agents/crew.ts`: the interface the office uses to drive agents, simulated or real.
- `src/agents/real.ts`: real agents: turns Claude Code events into office activity, pitches and approvals.
- `src/agents/sim.ts`: simulated agents for the browser.
- `src/agents/ideas.ts`: pitches made from what's in each project folder.
- `src/owner.ts`: whose office it is.
- `src/scenes/OfficeScene.ts`: turns events into movement, bubbles, screens and approvals.
- `src/world/map.ts`: floor plan, furniture, walkable grid, pathfinding.
- `src/art/`: all pixel art, drawn in code (no image assets).
- `src/ui/hud.ts`: what's in the side panels.
- `src/ui/panels.ts`: the tab rail, sliding panels and pixel icons.
- `src/ui/windows.ts`: Settings and the Work Board.
- `src/ui/paste.ts`: pasting and dropping pictures into text boxes.
- `src/audio/lofi.ts`: the generated lo-fi music.
