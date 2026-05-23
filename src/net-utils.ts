import * as net from 'net';

export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => { s.close(); resolve(false); });
    s.once('listening', () => { s.close(() => resolve(true)); });
    s.listen(port, '0.0.0.0');
  });
}

export async function findAvailablePort(start: number, maxPort: number = 65535): Promise<number> {
  const BATCH_SIZE = 20;

  for (let base = start; base <= maxPort; base += BATCH_SIZE) {
    const batch = Array.from({ length: Math.min(BATCH_SIZE, maxPort - base + 1) }, (_, i) => base + i);
    const results = await Promise.all(batch.map(isPortAvailable));
    const idx = results.findIndex(Boolean);
    if (idx >= 0) return batch[idx];
  }

  throw new Error(`No available port found between ${start} and ${maxPort}`);
}

export async function findAvailablePortSequential(start: number, maxAttempts: number = 100): Promise<number> {
  let port = start;
  let attempts = 0;
  while (attempts < maxAttempts) {
    if (await isPortAvailable(port)) {
      return port;
    }
    port++;
    attempts++;
  }
  throw new Error(`No available port found after ${maxAttempts} attempts starting at ${start}`);
}
