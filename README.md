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
   - **Pass**: they go back and come up with something else.
   - **Redirect**: send them to another project or a brand new one, optionally with
     exact instructions. Without instructions they research that project and come back
     with a new pitch.
4. **Work**: types at their desk, runs things at the mainframe, and asks before risky
   commands (*Commands Waiting for OK*), then drops the result in the mail room outbox.

*Auto-approve (let go)* approves pitches and commands without asking.

Right now the agents are simulated (`src/agents/sim.ts`), but they pitch on your real
project folders, which Electron scans read-only (`electron/projects.mjs`).

| Agent activity | In the office |
|---|---|
| thinking | sits at the conference table |
| reading | goes to the archive shelves |
| writing | types at its desk, code scrolls on the CRT |
| running | stands at the mainframe |
| queued | waits in line outside Ahmad's office |
| pitching | stands at Ahmad's desk |
| awaiting | stands by its desk with a hand raised |
| talking | walks over to a colleague |
| done | drops a report in the mail room outbox |
| idle | coffee in the break room |

## Layout

- `electron/main.mjs`: the desktop window. Step 2 will run the Claude agents here, in Node.
- `electron/projects.mjs`, `electron/preload.cjs`: read-only scan of the projects folder, exposed to the page.
- `scripts/dev.mjs`: starts Vite and opens Electron on it.
- `src/agents/types.ts`: the `AgentEvent` contract. Anything that emits these can drive the office.
- `src/agents/sim.ts`: fake agents: research, queue, pitch, work. Will be swapped for real Claude agents.
- `src/agents/ideas.ts`: pitches made from what's in each project folder.
- `src/owner.ts`: whose office it is.
- `src/scenes/OfficeScene.ts`: turns events into movement, bubbles, screens and approvals.
- `src/world/map.ts`: floor plan, furniture, walkable grid, pathfinding.
- `src/art/`: all pixel art, drawn in code (no image assets).
- `src/ui/hud.ts`: the Windows 95 side panels.
