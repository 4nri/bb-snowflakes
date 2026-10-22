import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=(process.env.SMOKE_BASE||'http://127.0.0.1:4173').replace(/\/$/,'');
await mkdir('output/playwright',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const results={};
try{
 const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'no-preference'});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.__soft={gradients:0,images:0,fills:0,arcs:0};
  for(const [method,key] of [['createRadialGradient','gradients'],['drawImage','images'],['fill','fills'],['arc','arcs']]){
   const original=CanvasRenderingContext2D.prototype[method];
   CanvasRenderingContext2D.prototype[method]=function(...args){window.__soft[key]++;return original.apply(this,args);};
  }
 });
 // Start with no blur: this also checks the first transition creates the cache lazily.
 const config={version:1,settings:{count:40,size:2,sizeVariation:1,blur:0,enabled:true},area:'content'};
 await page.goto(base+'/#'+new URLSearchParams({snow:JSON.stringify(config)}));
 await page.locator('#main-screen canvas').waitFor();await page.locator('#pause').click();
 assert.equal(await page.evaluate(()=>window.__soft.gradients),0);
 const set=async(key,value)=>{await page.locator('#'+key).fill(String(value));await page.locator('#'+key).dispatchEvent('change');};
 await set('blur',1);assert.equal(await page.locator('#blur-value').innerText(),'100%');
 assert.equal(await page.evaluate(()=>window.__soft.gradients),8,'Only one shared atlas for both canvases');
 assert.equal(await page.locator('canvas').count(),2,'No extra visible layers');
 const counts=await page.evaluate(()=>({...window.__soft}));
 for(const value of [0,.1,.55,1]){await set('size',6);await set('sizeVariation',value);await set('blur',value);}
 assert.equal(await page.evaluate(()=>window.__soft.gradients),8,'Control changes reuse the atlas');
 assert.ok(await page.evaluate(n=>window.__soft.images>n,counts.images));
 await page.locator('#blur').focus();await page.keyboard.press('Home');
 assert.equal(await page.locator('#blur').getAttribute('aria-valuetext'),'0%');
 await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#blur-value').innerText(),'5%');
 await set('blur',.65);
 const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();
 const download=await downloadPromise;await download.saveAs('output/playwright/blur-settings.json');
 const exported=JSON.parse(await readFile('output/playwright/blur-settings.json','utf8'));
 assert.equal(exported.settings.blur,.65);
 await set('blur',0);await page.locator('#file').setInputFiles({name:'snow.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
 await page.waitForFunction(()=>document.querySelector('#blur').value==='0.65');
 await page.locator('#share').click();
 assert.equal(JSON.parse(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('snow')).settings.blur,.65);
 await set('blur',.25);await page.reload();await page.locator('#main-screen canvas').waitFor();
 assert.equal(await page.locator('#blur').inputValue(),'0.25','Immediate reload flushes pending blur');
 const old={version:1,settings:{count:40,size:2,sizeVariation:.8,enabled:true},area:'hero'};
 await page.goto('about:blank');await page.goto(base+'/#'+new URLSearchParams({snow:JSON.stringify(old)}));
 await page.locator('#main-screen canvas').waitFor();assert.equal(await page.locator('#blur').inputValue(),'0.4');
 await page.locator('#reset').click();assert.equal(await page.locator('#blur').inputValue(),'0.4');
 await page.setViewportSize({width:393,height:852});await page.locator('#blur').scrollIntoViewIfNeeded();
 const geometry=await page.evaluate(()=>({slider:document.querySelector('#blur').getBoundingClientRect().toJSON(),phones:[...document.querySelectorAll('.phone')].map(p=>p.getBoundingClientRect().toJSON()),width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth}));
 assert.ok(geometry.slider.height>=32&&geometry.slider.top>=0&&geometry.slider.bottom<=geometry.height);
 assert.ok(geometry.phones.every(p=>p.top>=0&&p.bottom<=geometry.height));assert.ok(geometry.scrollWidth<=geometry.width);
 await page.screenshot({path:'output/playwright/blur-mobile.png'});results.mobile=geometry;
 await context.close();
 // Fixed scene: inspect actual alpha outside each original circle, without image pixels underneath.
 const fixture=await browser.newContext({viewport:{width:393,height:852},reducedMotion:'reduce'});
 const f=await fixture.newPage();f.on('pageerror',e=>errors.push(e.message));
 await f.goto(base+'/tests/fixtures/snow-perf.html?count=3&size=6&sizeVariation=1&blur=0&sway=0');
 await f.waitForFunction(()=>window.effect?.particles.length===3);
 results.pixels=await f.evaluate(()=>{
  const e=window.effect;e.pause();
  [.25,.625,1].forEach((d,i)=>{const p=e.particles[i];p.baseDepth=d;p.x=70+i*120;p.y=250;});
  e.update({sizeVariation:0});e.update({sizeVariation:1});
  const before=e.particles.map(p=>({x:p.x,y:p.y,phase:p.phase,baseDepth:p.baseDepth,depth:p.depth}));
  const alpha=(x,y)=>e.ctx.getImageData(x,y,1,1).data[3];
  const sharp=[alpha(72,250),alpha(194,250),alpha(318,250)];
  e.update({blur:1});
  const soft=[alpha(72,250),alpha(194,250),alpha(318,250)];
  const after=e.particles.map(p=>({x:p.x,y:p.y,phase:p.phase,baseDepth:p.baseDepth,depth:p.depth}));
  const levels=e.particles.map(p=>p.blurLevel),image=e.canvas.toDataURL();
  const filter=e.ctx.filter,shadowBlur=e.ctx.shadowBlur;
  e.destroy();return{sharp,soft,before,after,levels,filter,shadowBlur,image};
 });
 const p=results.pixels;
 assert.equal(p.sharp[0],0);assert.equal(p.sharp[1],0);assert.equal(p.sharp[2],0);
 assert.ok(p.soft[0]>0&&p.soft[2]>0,'Far and near discs spread beyond the original edge');assert.equal(p.soft[1],0,'Middle stays sharp');
 assert.deepEqual(p.before,p.after,'Changing blur preserves particles and motion');
 assert.deepEqual(p.levels,[4,0,8]);assert.equal(p.filter,'none');assert.equal(p.shadowBlur,0);
 await writeFile('output/playwright/blur-particles.png',Buffer.from(p.image.split(',')[1],'base64'));delete p.image;
 await fixture.close();assert.deepEqual(errors,[]);
 await writeFile('output/playwright/blur-verification.json',JSON.stringify({passed:true,...results,errors},null,2)+'\n');
 console.log(JSON.stringify({passed:true,checks:['lazy shared cache','no new layers','cache reused while tuning','paused changes','keyboard','JSON export/import','share','immediate reload','legacy settings','mobile preview','actual near/far alpha spread','sharp focus','no particle resets','no canvas filter/shadowBlur'],pixels:p,errors}));
}finally{await browser.close();}
