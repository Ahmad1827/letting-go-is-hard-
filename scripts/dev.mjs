// Starts the Vite dev server, then opens the Electron window on it (with hot reload).
import { spawn } from 'node:child_process';
import electron from 'electron';
import { createServer } from 'vite';

const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];

const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
child.on('close', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
