import {DEFAULTS} from '../src/snow.js';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=(process.env.SMOKE_BASE||'http://127.0.0.1:4173').replace(/\/$/,'');
await mkdir('output/playwright',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try{
 for(const [name,width,height] of [['wide',1440,1000],['desktop',1280,800],['mobile',393,852],['small',360,740]]){
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'no-preference'});
  const page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
  await page.goto(base);await page.locator('canvas').first().waitFor();
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});
  await page.waitForFunction(()=>Number(document.querySelector('#metric-fps').textContent)>0);
  const before=await page.evaluate(()=>{
   const box=selector=>document.querySelector(selector).getBoundingClientRect().toJSON();
   return{export:box('#export'),pause:box('#pause'),preview:box('#preview-scroll'),phones:[box('#start-screen'),box('#main-screen')],captions:[...document.querySelectorAll('.screen-card figcaption')].map(el=>el.getBoundingClientRect().toJSON()),slider:box('#sizeVariation'),window:{width:innerWidth,height:innerHeight},font:document.fonts.check('500 14px "Golos Text"'),scrollWidth:document.documentElement.scrollWidth};
  });
  assert.ok(before.font);assert.ok(before.slider.height>=28);
  assert.ok(before.scrollWidth<=width,'No page overflow at '+name);
  const visible=b=>b.top>=0&&b.bottom<=height&&b.left>=0&&b.right<=width;
  assert.ok(visible(before.export),'Export visible at '+name);assert.ok(visible(before.pause),'Pause visible at '+name);
  assert.ok(before.phones.every(b=>b.top>=before.preview.top-1&&b.bottom<=before.preview.bottom+1&&b.left>=before.preview.left-1&&b.right<=before.preview.right+1),'Both full mockups fit at '+name);
  assert.ok(before.captions.every(b=>b.top>=before.preview.top-1),'Captions stay inside preview');
  assert.equal(await page.evaluate(()=>{
   const top=document.querySelector('#preview-scroll').getBoundingClientRect().top;
   return [...document.querySelectorAll('.screen-name,.screen-note')].every(el=>el.getBoundingClientRect().top>=top-1);
  }),true,'Caption text is not clipped above preview');
  await page.screenshot({path:'output/playwright/design-after-'+name+'.png'});
  await page.locator('#sizeVariation').scrollIntoViewIfNeeded();
  const editing=await page.evaluate(()=>({scrollY,slider:document.querySelector('#sizeVariation').getBoundingClientRect().toJSON(),phones:[...document.querySelectorAll('.phone')].map(el=>el.getBoundingClientRect().toJSON())}));
  assert.ok(editing.slider.top>=0&&editing.slider.bottom<=height);
  assert.ok(editing.phones.every(b=>b.top>=0&&b.bottom<=height),'Preview remains visible while editing at '+name);
  if(width<=760)await page.screenshot({path:'output/playwright/design-editing-'+name+'.png'});
  await page.locator('#area').scrollIntoViewIfNeeded();
  assert.ok(visible(await page.locator('#export').boundingBox().then(b=>({top:b.y,bottom:b.y+b.height,left:b.x,right:b.x+b.width}))));
  await page.locator('#area').selectOption('hero');
  await page.locator('#pause').click();assert.equal((await page.locator('#state-label').innerText()),'На паузе');
  await page.locator('#enabled').uncheck();assert.equal(await page.locator('#state-label').innerText(),'Снег выключен');
  assert.ok(await page.locator('#pause').isDisabled());await page.locator('#enabled').check();
  await page.locator('#count').fill('0');assert.equal(await page.locator('#state-label').innerText(),'Нет частиц');
  assert.ok(await page.locator('#pause').isDisabled());
  await page.locator('#reset').click();await page.locator('#zoom').selectOption('1');
  assert.equal(await page.evaluate(()=>document.querySelector('#start-screen').getBoundingClientRect().width),393);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Manual zoom stays inside preview');
  await page.locator('#zoom').selectOption('auto');
  let nativeFullscreen=null;
  if(name==='desktop'){
   await page.locator('#fullscreen').click();
   await page.waitForFunction(()=>document.fullscreenElement||document.querySelector('.workspace').classList.contains('presentation'));
   nativeFullscreen=await page.evaluate(()=>document.fullscreenElement===document.querySelector('.workspace'));
   await page.locator('#fullscreen').click();
   await page.waitForFunction(()=>!document.fullscreenElement&&!document.querySelector('.workspace').classList.contains('presentation'));
  }
  // Exercise fallback presentation mode without relying on window manager fullscreen.
  await page.evaluate(()=>{document.querySelector('.workspace').requestFullscreen=undefined;});
  await page.locator('#fullscreen').click();
  assert.equal(await page.locator('.workspace').evaluate(el=>el.classList.contains('presentation')),true);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.workspace').evaluate(el=>el.classList.contains('presentation')),false);
  await page.locator('#count').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#count').inputValue(),String(DEFAULTS.count+1));
  await page.locator('#reset').click();
  assert.deepEqual(errors,[]);assert.deepEqual(external,[],'No external runtime resources');
  results.push({name,before,editing,nativeFullscreen,errors,external});await context.close();
 }
 const reduced=await browser.newContext({viewport:{width:393,height:852},reducedMotion:'reduce'});
 const page=await reduced.newPage();await page.goto(base);await page.locator('canvas').first().waitFor();
 assert.equal(await page.locator('#state-label').innerText(),'На паузе');assert.equal(await page.locator('#motion-notice').isVisible(),true);
 await page.locator('#pause').click();assert.equal(await page.locator('#state-label').innerText(),'Снег идёт');await reduced.close();
 await writeFile('output/playwright/design-verification.json',JSON.stringify({results,reducedMotion:true},null,2)+'\n');
 console.log(JSON.stringify({passed:true,viewports:results.map(r=>r.name),nativeFullscreen:results.find(r=>r.name==='desktop').nativeFullscreen,checks:['full mockups fit','export/pause pinned','preview remains while editing','large slider hit area','local fonts only','zero/disabled/paused states','zoom','fullscreen and fallback/Escape','keyboard','reduced motion'],errors:[]}));
}finally{await browser.close();}
