import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('shared, workbook, and local solver CSS use only grayscale colors and documented dense annotations',async()=>{
  for(const file of ['shared/ui.css','app/workbook.css','timetable-solver/web/style.css']){
    const css=(await readFile(file,'utf8')).replace(/\/\*[\s\S]*?\*\//g,'');
    for(const [color] of css.matchAll(/#[\da-f]{3,8}\b/gi)){
      let hex=color.slice(1);if(hex.length<=4)hex=[...hex].map(c=>c+c).join('');
      assert.equal(hex.slice(0,2).toLowerCase(),hex.slice(2,4).toLowerCase(),`${file}: ${color}`);
      assert.equal(hex.slice(0,2).toLowerCase(),hex.slice(4,6).toLowerCase(),`${file}: ${color}`);
    }
    assert.doesNotMatch(css,/\b(?:rgba?|hsla?|oklch|color)\(/,file+' uses explicit grayscale hex and tokens');
    for(const [rule,selector,size] of css.matchAll(/([^{}]+)\{[^{}]*?font-size:(\d+)px[^{}]*\}/g)){
      if(Number(size)<12)assert.equal(selector.trim(),'.split-plan-button small,.split-assignment small',`${file}: ${rule}`);
    }
  }
});
