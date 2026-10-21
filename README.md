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

Each agent loops through the same cycle:

1. **Research**: looks through the folders in `~/proiecte` (in the conference room and the archive).
2. **Queue**: walks to the line outside Ahmad's office. One pitches at a time, three
   wait at the door, the rest wait at their desks.
3. **Pitch**: stands at Ahmad's desk. The *Ahmad's Office* panel shows the idea, the
   plan and the git branch it would use. You can:
   - **Approve**: they go and do it, on its own branch.
   - **Don't approve**: they go back and come up with something else.
   - **Tell them what to do instead** (in the pitch card, or by messaging them while they
     pitch): they work out which project you mean, or start a new one, and get going
     without pitching again.
4. **Work**: types at their desk, runs things at the mainframe, and asks before risky
   commands (*Commands Waiting for OK*), then drops the result in the mail room outbox.

*Auto-approve (let go)* approves pitches and commands without asking.

### Teams

*New team...* groups people you've hired: one **manager** and any number of **workers**.
Give the team a task, or leave it empty and the manager researches and pitches an idea
big enough for the team. Once the work starts:

- The manager plans it and hands each worker a piece.
- Each worker builds on their own branch, started from the team's branch, and reports
  back when done. Workers wait at their desks between tasks.
- The manager reviews their work, merges it into the team branch, runs the checks, and
  tells you it's done. Then the manager goes looking for the team's next idea.

*Disband* sends everyone back to working on their own.

In the desktop app every employee is a real **Claude Code** session: the `claude` CLI
installed on this machine, using its existing login (no API key). Electron's main process
runs one headless session per agent (`electron/agents.mjs`) and the office answers its
permission prompts:

- While researching, agents may only read. Anything that would change a file is refused.
- Approved work happens in a git worktree under `~/proiecte/.letting-go/worktrees/` on the
  agent's own branch, so your checkout is never touched. Agents commit there and never push.
  A project without git history gets edited in place, and every change asks first.
- Commands that need permission show up under *Commands Waiting for OK*.

**Pictures:** paste (Ctrl+V) or drop pictures into an agent's message box, the "do this
instead" box on a pitch, or a new team's task. They go to Claude along with your words.

**Music:** lo-fi office music plays in the background, generated live in the app (no audio
files). Turn it off or change the volume in the taskbar; it remembers your choice.

The taskbar shows your plan's usage (the 5-hour and weekly windows, as Claude Code reports
them). Click it for reset times and how many tokens each agent has used this session.

Click an agent to see their full log, switch their model (Fable 5.1, Opus 5.5, Sonnet 5.5,
Haiku 5.5, older versions, or Claude Code's default), stop them, or message them. In a plain browser (`npx vite`) the
agents are simulated instead (`src/agents/sim.ts`).

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

## Layout

- `electron/main.mjs`: the desktop window.
- `electron/agents.mjs`: runs one headless Claude Code session per agent and prepares worktrees.
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
- `src/ui/hud.ts`: the Windows 95 side panels.
- `src/ui/paste.ts`: pasting and dropping pictures into text boxes.
- `src/audio/lofi.ts`: the generated lo-fi music.
