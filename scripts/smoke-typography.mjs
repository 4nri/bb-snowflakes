import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=(process.env.SMOKE_BASE||'http://127.0.0.1:4173').replace(/\/$/,'');
const before=process.env.TYPO_BEFORE==='1';
await mkdir('output/playwright',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try{
 for(const [name,width,height] of [['wide',1440,1000],['desktop',1280,800],['narrow',1024,768],['mobile',393,852],['small',360,740],['minimum',320,740]]){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('#main-screen canvas').waitFor();
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});
  const data=await page.evaluate(()=>{
   const rect=e=>e.getBoundingClientRect().toJSON();
   const textRect=e=>{const range=document.createRange();range.selectNodeContents(e);return range.getBoundingClientRect().toJSON();};
   const details=e=>{const s=getComputedStyle(e);return{text:e.textContent.trim(),rect:rect(e),textRect:textRect(e),font:s.fontFamily,size:s.fontSize,lineHeight:s.lineHeight,weight:s.fontWeight};};
   return {
    actions:[...document.querySelectorAll('.secondary-actions > *')].map(details),
    controls:[...document.querySelectorAll('.range-control')].map(e=>({id:e.querySelector('input').id,rect:rect(e),label:details(e.querySelector('label')),hint:e.querySelector('.control-hint,.range-ends')?details(e.querySelector('.control-hint,.range-ends')):null,marginBottom:getComputedStyle(e).marginBottom})),
    type:[...document.querySelectorAll('h1,h2,legend,.brand span,.source-link,.button,.presets button,.screen-name,.screen-note,.playback-state,.metrics dt,.metrics dd,.select-row,.secondary-actions > *')].filter(e=>e.getClientRects().length).map(details),
    export:rect(document.querySelector('#export')),pause:rect(document.querySelector('#pause')),panel:rect(document.querySelector('.panel-scroll')),
    selects:[...document.querySelectorAll('select')].map(e=>{
     const style=getComputedStyle(e),ctx=document.createElement('canvas').getContext('2d');
     ctx.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
     return{id:e.id,text:e.selectedOptions[0].text,textWidth:ctx.measureText(e.selectedOptions[0].text).width,available:e.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)};
    }),
    fonts:document.fonts.check('400 13px "Golos Text"'),scrollWidth:document.documentElement.scrollWidth,
   };
  });
  data.name=name;data.width=width;data.height=height;data.errors=errors;
  if(!before){
   assert.ok(data.fonts);assert.equal(data.scrollWidth,width,'Page fits at '+name);
   assert.ok(data.export.top>=0&&data.export.bottom<=height,'Export visible at '+name);
   assert.ok(data.pause.top>=0&&data.pause.bottom<=height,'Pause visible at '+name);
   const tops=data.actions.map(e=>e.textRect.top),bottoms=data.actions.map(e=>e.textRect.bottom);
   assert.ok(Math.max(...tops)-Math.min(...tops)<=.5,'Action text tops aligned at '+name);
   assert.ok(Math.max(...bottoms)-Math.min(...bottoms)<=.5,'Action text baselines aligned at '+name);
   for(const a of data.actions)assert.ok(a.textRect.left>=a.rect.left-1&&a.textRect.right<=a.rect.right+1,'Action text fits: '+a.text);
   for(const s of data.selects)assert.ok(s.textWidth<=s.available,'Selected option fits at '+name+': '+s.id);
   for(let i=1;i<data.controls.length;i++){
    const a=data.controls[i-1],b=data.controls[i];
    if(b.id!=='speed')assert.ok(b.rect.top-a.rect.bottom>=18,'Spacing between '+a.id+' and '+b.id+' at '+name);
   }
   for(const t of data.type){
    assert.notEqual(t.lineHeight,'normal','Explicit line height for '+t.text+' at '+name);
    assert.ok(parseFloat(t.size)>=12,'Readable type size for '+t.text);
   }
   for(const c of data.controls){
    assert.ok(c.label.textRect.left>=c.label.rect.left-1&&c.label.textRect.right<=c.label.rect.right+1,'Control label fits at '+name+': '+c.id);
    if(c.hint)assert.ok(c.hint.textRect.bottom<=c.hint.rect.bottom+1&&c.hint.textRect.right<=c.hint.rect.right+1,'Hint wraps inside its block at '+name);
   }
   assert.deepEqual(errors,[]);
  }
  if(['wide','mobile','minimum'].includes(name)){
   await page.screenshot({path:`output/playwright/typography-${before?'before':'after'}-${name}.png`});
   await page.locator('#blur').scrollIntoViewIfNeeded();
   await page.screenshot({path:`output/playwright/typography-${before?'before':'after'}-editing-${name}.png`});
   if(name==='wide')await page.locator('.panel').screenshot({path:`output/playwright/typography-${before?'before':'after'}-panel.png`});
  }
  results.push(data);await context.close();
 }
 await writeFile(`output/playwright/typography-${before?'before':'after'}.json`,JSON.stringify({passed:!before,results},null,2)+'\n');
 console.log(JSON.stringify({passed:!before,viewports:results.map(r=>r.name),actions:results.map(r=>({viewport:r.name,tops:r.actions.map(a=>a.textRect.top),lineHeights:r.actions.map(a=>a.lineHeight)})),errors:results.flatMap(r=>r.errors)}));
}finally{await browser.close();}
