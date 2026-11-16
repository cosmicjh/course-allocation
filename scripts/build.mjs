import {mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import {build} from 'esbuild';
await rm(new URL('../dist/assets',import.meta.url),{recursive:true,force:true});
await mkdir('dist/assets',{recursive:true});
await mkdir('dist/shared',{recursive:true});
await copyFile('shared/ui.css','dist/shared/ui.css');
await copyFile('config.js','dist/config.js');
const assets=await build({entryPoints:['app/workbook.js','app/workbook.css'],bundle:true,minify:true,format:'esm',target:'es2022',outdir:'dist/assets',entryNames:'[name]-[hash]',metafile:true});
let html=await readFile('index.html','utf8');
for(const [file,output] of Object.entries(assets.metafile.outputs)){
  if(output.entryPoint)html=html.replace('./'+output.entryPoint,'./'+file.replace(/^dist\//,''));
}
await writeFile('dist/index.html',html);
await writeFile('dist/_routes.json',JSON.stringify({version:1,include:['/api/*'],exclude:[]},null,2));
await writeFile('dist/_headers','/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n  X-Frame-Options: DENY\n  Cache-Control: no-cache\n');
await build({entryPoints:['functions/api/[[path]].js'],bundle:true,format:'esm',platform:'browser',write:false});
console.log('정적 파일과 Functions 번들 검증 완료: dist/');
