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

| Agent activity | In the office |
|---|---|
| thinking | paces near its cubicle |
| reading | goes to the archive shelves |
| writing | types at its desk, code scrolls on the CRT |
| running | stands at the mainframe |
| awaiting | walks to your desk and raises a hand |
| talking | walks over to a colleague |
| done | drops a report in the outbox |
| idle | coffee in the kitchenette |

## Layout

- `electron/main.mjs`: the desktop window. Step 2 will run the Claude agents here, in Node.
- `scripts/dev.mjs`: starts Vite and opens Electron on it.
- `src/agents/types.ts`: the `AgentEvent` contract. Anything that emits these can drive the office.
- `src/agents/sim.ts`: fake agents (step 1). Will be swapped for real Claude agents.
- `src/scenes/OfficeScene.ts`: turns events into movement, bubbles, screens and approvals.
- `src/world/map.ts`: floor plan, furniture, walkable grid, pathfinding.
- `src/art/`: all pixel art, drawn in code (no image assets).
- `src/ui/hud.ts`: the Windows 95 side panels.
