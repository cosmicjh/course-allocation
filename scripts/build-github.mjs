import './build.mjs';
import {mkdir,copyFile,cp,writeFile} from 'node:fs/promises';
import {CLOUDFLARE_API} from '../shared/deployment.js';

await mkdir('dist-github',{recursive:true});
await copyFile('dist/index.html','dist-github/index.html');
await cp('dist/shared','dist-github/shared',{recursive:true});
await writeFile('dist-github/config.js','// Public configuration; authentication secrets stay on Cloudflare.\nwindow.ALLOCATION_CONFIG = '+JSON.stringify({apiBase:CLOUDFLARE_API,appId:'course-allocation-cloudflare'})+';\n');
await writeFile('dist-github/.nojekyll','');
console.log('GitHub Pages 정적 출력 완료: dist-github/');
