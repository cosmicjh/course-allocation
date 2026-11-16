import './build.mjs';
import {mkdir,copyFile,cp,writeFile,rm} from 'node:fs/promises';
import {CLOUDFLARE_API} from '../shared/deployment.js';

await rm(new URL('../dist-github/assets',import.meta.url),{recursive:true,force:true});
await mkdir('dist-github',{recursive:true});
await copyFile('dist/index.html','dist-github/index.html');
await cp('dist/assets','dist-github/assets',{recursive:true});
await mkdir('dist-github/shared',{recursive:true});
await copyFile('dist/shared/ui.css','dist-github/shared/ui.css');
await writeFile('dist-github/config.js','// Public configuration; authentication secrets stay on Cloudflare.\nwindow.ALLOCATION_CONFIG = '+JSON.stringify({apiBase:CLOUDFLARE_API,appId:'course-allocation-cloudflare'})+';\n');
await writeFile('dist-github/.nojekyll','');
console.log('GitHub Pages 정적 출력 완료: dist-github/');
