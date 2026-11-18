import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';

const output = new URL('../dist/', import.meta.url);
const notice = new URL('../moved.html', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output);
await copyFile(notice, new URL('index.html', output));
await copyFile(notice, new URL('404.html', output));
await writeFile(new URL('_routes.json', output), JSON.stringify({ version: 1, include: ['/api', '/api/*'], exclude: [] }));
await writeFile(new URL('_headers', output), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n  X-Frame-Options: DENY\n  Cache-Control: no-cache\n');
