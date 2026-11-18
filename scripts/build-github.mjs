import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';

const output = new URL('../dist-github/', import.meta.url);
const notice = new URL('../moved.html', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output);
await copyFile(notice, new URL('index.html', output));
await copyFile(notice, new URL('404.html', output));
await writeFile(new URL('.nojekyll', output), '');
