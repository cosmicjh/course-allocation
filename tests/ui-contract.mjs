import assert from 'node:assert/strict';

// Sheet tabs retain their active underline; every button has transparent paint.
// No border/background exceptions are currently required.
export async function checkUi(page,name,directory){
  const original=page.viewportSize();
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    const result=await page.evaluate(()=>{
      const visible=element=>element.checkVisibility()&&element.getBoundingClientRect().width>0&&element.getBoundingClientRect().height>0;
      const buttons=[...document.querySelectorAll('button')].filter(visible);
      const violations=[];
      for(const button of buttons){
        const style=getComputedStyle(button),label=button.getAttribute('aria-label')||button.textContent.trim();
        if(style.backgroundColor!=='rgba(0, 0, 0, 0)'||style.backgroundImage!=='none'||['Top','Right','Bottom','Left'].some(side=>parseFloat(style['border'+side+'Width'])>0))violations.push({label,border:style.border,background:style.backgroundColor});
        if(button.getBoundingClientRect().height<(innerWidth<=640?44:32)-.1)violations.push({label,height:button.getBoundingClientRect().height});
        if(!/^"?Pretendard/.test(style.fontFamily))violations.push({label,font:style.fontFamily});
      }
      const font=getComputedStyle(document.documentElement).fontFamily;
      const sheet=[...document.styleSheets].find(sheet=>sheet.href?.startsWith(location.origin));
      const hostRule=sheet.insertRule(':root{--ui-font:"Pretendard Host Subset",sans-serif}',0);
      const hostFont=getComputedStyle(document.documentElement).fontFamily;sheet.deleteRule(hostRule);
      return {violations,buttonCount:buttons.length,font,hostFont,overflow:document.documentElement.scrollWidth>innerWidth,escaped:[...document.querySelectorAll('.workbook-header,.workbook-nav,.sheet-heading,.sheet-dock,dialog[open]')].filter(visible).filter(e=>e.getBoundingClientRect().right>innerWidth+.5).map(e=>e.className)};
    });
    assert.ok(result.buttonCount>0,name+' has visible buttons');
    assert.deepEqual(result.violations,[],`${name} ${viewport.width}px button contract`);
    assert.match(result.font,/^"?Pretendard/);
    assert.match(result.hostFont,/^"Pretendard Host Subset"/,'host :root font takes precedence over shared defaults');
    assert.equal(result.overflow,false,`${name} document overflow`);
    assert.deepEqual(result.escaped,[],`${name} controls overflow`);
    await page.screenshot({path:`${directory}/ui-${name}-${viewport.width}.png`,fullPage:true});
  }
  await page.setViewportSize(original);
}
