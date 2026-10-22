import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {cpus,arch} from 'node:os';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const legacyPath=process.env.LEGACY_HTML||'output/legacy/index.html';
let legacyHTML;
try{legacyHTML=await readFile(legacyPath,'utf8');}catch(error){
 if(error.code!=='ENOENT')throw error;
 const encoded=execFileSync('gh',['api','repos/4nri/bb_snowflakes/contents/index.html?ref=c492fa2f979a01b5aea95fe28f821f46827b445e','--jq','.content'],{encoding:'utf8'});
 legacyHTML=Buffer.from(encoded,'base64').toString('utf8');
 await mkdir(dirname(resolve(legacyPath)),{recursive:true});await writeFile(legacyPath,legacyHTML);
}
if(createHash('sha256').update(legacyHTML).digest('hex')!=='89a9a109b51f2bbaf297a4bd9241bc6d3dc4beb0eb10d3f438e30639666aaeb0')throw new Error('Legacy source does not match the pinned commit');
const currentSource=await readFile('src/snow.js','utf8');
const legacyScript=legacyHTML.match(/<script>([\s\S]*?)<\/script>/i)[1];
const options=process.env.COMPARE_OPTIONS_FILE
 ? JSON.parse(await readFile(process.env.COMPARE_OPTIONS_FILE,'utf8'))
 : process.env.COMPARE_OPTIONS?JSON.parse(process.env.COMPARE_OPTIONS):{};
const duration=options.duration||8000,base=options.base||'http://127.0.0.1:4173';
const scenarios=[];
for(const rate of [1,6,10]){
 scenarios.push({version:'legacy',profile:'original',count:3200,rate});
 scenarios.push({version:'current',profile:'original',count:40,rate});
 scenarios.push({version:'legacy',profile:'matched-blur',count:200,rate});
 scenarios.push({version:'current',profile:'matched',count:200,rate});
 scenarios.push({version:'legacy',profile:'matched-plain',count:200,rate});
 scenarios.push({version:'legacy',profile:'matched-plain',count:40,rate});
}
for(let repeat=1;repeat<=3;repeat++){
 const pair=[{version:'legacy',profile:'matched-plain',count:200,rate:10,repeat},{version:'current',profile:'matched',count:200,rate:10,repeat}];
 scenarios.push(...(repeat%2?pair:pair.reverse()));
}
scenarios.push({version:'legacy',profile:'matched-plain',count:0,rate:10},{version:'current',profile:'matched',count:0,rate:10});
const output=resolve(process.env.COMPARE_OUTPUT||'output/playwright/legacy-comparison.json');await mkdir(dirname(output),{recursive:true});
const result={date:new Date().toISOString(),legacy:{repository:'4nri/bb_snowflakes',commit:'c492fa2f979a01b5aea95fe28f821f46827b445e',sha256:createHash('sha256').update(legacyHTML).digest('hex'),htmlBytes:Buffer.byteLength(legacyHTML),htmlGzip:gzipSync(legacyHTML).length,scriptBytes:Buffer.byteLength(legacyScript),scriptGzip:gzipSync(legacyScript).length},current:{repository:'4nri/bb-snowflakes',commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sha256:createHash('sha256').update(currentSource).digest('hex'),scriptBytes:Buffer.byteLength(currentSource),scriptGzip:gzipSync(currentSource).length},host:{cpu:cpus()[0]?.model,arch:arch()},durationMs:duration,results:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});result.browser=browser.version();
try{
 const context=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,reducedMotion:'no-preference'});
 const page=await context.newPage();const cdp=await context.newCDPSession(page);
 await page.route('**/legacy-benchmark.html',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:legacyHTML}));
 await page.addInitScript(()=>{
   let seed=20261022;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
   const nativeRAF=requestAnimationFrame.bind(window);let currentTime=null;
   window.__compare={clock:[],frames:[],draws:{},work:[],drawCalls:0,longTasks:[]};
   window.requestAnimationFrame=callback=>nativeRAF(t=>{
     const started=performance.now(),before=window.__compare.drawCalls;currentTime=t;
     try{callback(t);}finally{currentTime=null;if(window.__compare.drawCalls>before)window.__compare.frames.push(t);window.__compare.work.push(performance.now()-started);}
   });
   const clear=CanvasRenderingContext2D.prototype.clearRect;
   CanvasRenderingContext2D.prototype.clearRect=function(...args){if(currentTime!==null){const b=window.__compare;const id=this.canvas.id||this.canvas.parentElement.id||'canvas';b.drawCalls++;(b.draws[id]??=[]).push(currentTime);}return clear.apply(this,args);};
   const clock=t=>{window.__compare.clock.push(t);nativeRAF(clock);};nativeRAF(clock);
   new PerformanceObserver(list=>{for(const e of list.getEntries())window.__compare.longTasks.push({start:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});
 });
 for(const scenario of options.scenarios||scenarios){
   await cdp.send('Emulation.setCPUThrottlingRate',{rate:scenario.rate});
   await page.goto('about:blank');
   await page.goto(scenario.version==='legacy'?base+'/legacy-benchmark.html':base+'/tests/fixtures/snow-compare.html?count='+scenario.count);
   await page.locator('canvas').first().waitFor();
   if(scenario.version==='legacy'&&scenario.profile!=='original'){
     await page.evaluate(({count,plain,keepDefaults,keepBackground})=>{
       document.querySelector('.controls').hidden=true;
       if(!keepBackground)document.body.style.background='#1c2430 url(/assets/main.png) center / cover no-repeat';
       if(plain)document.querySelector('#frontLayer').style.filter='none';
       if(keepDefaults)return;
       const back=Math.round(count*.625),middle=Math.round(count*.3125),counts=[back,middle,count-back-middle];
       // Test adapter: match count, radius distribution, opacity and mean speed.
       // Keep the original update/draw/reset code and all three canvases unchanged.
       windSpeed=.875;fallSpeed=5;
       ['back','middle','front'].forEach((key,i)=>{Object.assign(layerConfig[key],{count:counts[i],sizeMin:1.48,sizeMax:2,speed:.06,opacity:.65});createLayer(key);});
     },{count:scenario.count,plain:scenario.profile==='matched-plain',keepDefaults:['default-renderer','original-no-controls'].includes(scenario.profile),keepBackground:scenario.profile==='original-no-controls'});
   }
   await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
   await page.waitForTimeout(2000);
   const actual=await page.evaluate(legacy=>legacy?{counts:Object.values(layerConfig).map(c=>c.count),total:Object.values(layerConfig).reduce((n,c)=>n+c.count,0),frontFilter:getComputedStyle(document.querySelector('#frontLayer')).filter,controlsHidden:document.querySelector('.controls').hidden}: {total:window.effect.settings.count,settings:window.effect.settings},scenario.version==='legacy');
   if(actual.total!==scenario.count)throw new Error('Configuration mismatch');
   const measurement=await page.evaluate(async duration=>{
     window.__compare={clock:[],frames:[],draws:{},work:[],drawCalls:0,longTasks:[]};
     const start=performance.now();await new Promise(r=>setTimeout(r,duration));const elapsed=performance.now()-start,b=window.__compare;
     const distribution=values=>{const sorted=[...values].sort((a,b)=>a-b);const sum=values.reduce((a,b)=>a+b,0);return{n:values.length,mean:sum/(values.length||1),p50:sorted[Math.floor(sorted.length*.5)]||0,p95:sorted[Math.floor(sorted.length*.95)]||0,p99:sorted[Math.floor(sorted.length*.99)]||0,max:sorted.at(-1)||0,sum};};
     const stats=times=>{const intervals=times.slice(1).map((t,i)=>t-times[i]);let min=Infinity;for(let t=start;t+1000<=start+elapsed;t+=100)min=Math.min(min,times.filter(v=>v>=t&&v<t+1000).length);return{frames:times.length,fps:times.length*1000/elapsed,minRolling1sFps:Number.isFinite(min)?min:0,intervalMs:distribution(intervals),gapsOver25ms:intervals.filter(v=>v>25).length,gapsOver50ms:intervals.filter(v=>v>50).length};};
     return{elapsedMs:elapsed,clock:stats(b.clock),effect:stats(b.frames),canvases:Object.fromEntries(Object.entries(b.draws).map(([k,t])=>[k,stats(t)])),callbackWorkMs:distribution(b.work),cpuWorkMsPerSecond:b.work.reduce((a,b)=>a+b,0)*1000/elapsed,longTasks:b.longTasks,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},buffers:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height,pixels:c.width*c.height}))};
   },duration);
   if(scenario.count&&!measurement.effect.frames)throw new Error('No animation frames');
   result.results.push({...scenario,actual,...measurement});await writeFile(output,JSON.stringify(result,null,2)+'\n');
   console.log(JSON.stringify({scenario,fps:measurement.effect.fps,min:measurement.effect.minRolling1sFps,gaps:measurement.effect.gapsOver25ms,workMean:measurement.callbackWorkMs.mean,workP95:measurement.callbackWorkMs.p95,cpuMsPerSec:measurement.cpuWorkMsPerSecond}));
 }
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
}finally{await browser.close();}
console.log('RESULT '+output);
