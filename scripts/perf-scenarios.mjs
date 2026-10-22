export default async function runScenarios(page, options={}) {
  const BASE = options.base || 'http://127.0.0.1:4173';
  const duration = options.duration || 8000;
  const cdp = await page.context().newCDPSession(page);
  await page.addInitScript(() => {
    const nativeRAF=window.requestAnimationFrame.bind(window);
    let frameTime=null;
    window.__bench={clock:[],draws:{},work:[],longTasks:[],skipped:[],drawCalls:0};
    window.requestAnimationFrame=callback=>nativeRAF(timestamp=>{
      const started=performance.now(),drawCalls=window.__bench.drawCalls;frameTime=timestamp;
      try{callback(timestamp);}finally{frameTime=null;window.__bench.work.push(performance.now()-started);if(window.__bench.drawCalls===drawCalls)window.__bench.skipped.push(timestamp);}
    });
    const originalClear=CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect=function(...args){
      if(frameTime!==null){window.__bench.drawCalls++;const id=this.canvas.parentElement?.id||'canvas';(window.__bench.draws[id]??=[]).push(frameTime);}
      return originalClear.apply(this,args);
    };
    const clock=timestamp=>{window.__bench.clock.push(timestamp);nativeRAF(clock);};nativeRAF(clock);
    new PerformanceObserver(list=>{for(const e of list.getEntries())window.__bench.longTasks.push({start:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});
  });
  const calibration=[];
  if(options.calibrate){
    await page.goto('about:blank');
    for(const rate of [1,4,6,10,1]){
      await cdp.send('Emulation.setCPUThrottlingRate',{rate});
      const ms=await page.evaluate(()=>{
        function task(){let value=1;for(let i=0;i<3000000;i++)value=Math.imul(value^i,1664525)+1013904223|0;return value;}
        task();task();const samples=[];
        for(let i=0;i<5;i++){const start=performance.now();const value=task();samples.push({ms:performance.now()-start,value});}
        return samples.sort((a,b)=>a.ms-b.ms)[2].ms;
      });
      calibration.push({rate,medianMs:ms});
    }
  }
  const scenarios=[];
  for(const rate of [1,4,6,10]) {
    scenarios.push({mode:'module-mobile',rate,count:0,enabled:false});
    for(const count of [40,110,200])scenarios.push({mode:'module-mobile',rate,count,enabled:true});
  }
  for(const rate of [1,6,10]) {
    scenarios.push({mode:'demo-desktop',rate,count:0,enabled:false});
    for(const count of [40,110,200])scenarios.push({mode:'demo-desktop',rate,count,enabled:true});
  }
  for(const rate of [6,10])scenarios.push({mode:'demo-mobile',rate,count:40,enabled:true});
  const result={timestamp:new Date().toISOString(),browser:page.context().browser().version(),durationMs:duration,calibration,method:'CDP Emulation.setCPUThrottlingRate; real rAF timestamps at actual canvas clearRect; 1s rolling windows; no tracing overhead',results:[]};
  for(const scenario of options.scenarios || scenarios) {
    const mobile=scenario.mode!=='demo-desktop';
    await page.setViewportSize(mobile?{width:393,height:852}:{width:1280,height:900});
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:mobile?393:1280,height:mobile?852:900,deviceScaleFactor:mobile?3:1,mobile});
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:scenario.rate});
    const settings={count:scenario.count,size:scenario.size??2,sizeVariation:scenario.sizeVariation??.8,speed:scenario.count===110?85:28,wind:scenario.count===110?60:6,sway:10,opacity:.65,enabled:scenario.enabled};
    const url=scenario.mode==='module-mobile'?BASE+'/tests/fixtures/snow-perf.html?'+new URLSearchParams(settings):BASE+'/#'+new URLSearchParams({snow:JSON.stringify({version:1,settings,area:'content'})});
    await page.goto('about:blank');
    await page.goto(url);
    await page.locator('canvas').first().waitFor();
    await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
    const actual=await page.evaluate(()=>window.effect?{...window.effect.settings}:{count:Number(document.querySelector('#count').value),size:Number(document.querySelector('#size').value),sizeVariation:Number(document.querySelector('#sizeVariation').value),enabled:document.querySelector('#enabled').checked});
    if(actual.count!==scenario.count||actual.enabled!==scenario.enabled||actual.size!==settings.size||actual.sizeVariation!==settings.sizeVariation)throw new Error('Scenario did not apply: '+JSON.stringify({scenario,actual}));
    await page.waitForTimeout(2000);
    const measured=await page.evaluate(async ({duration,interaction,control})=>{
      window.__bench={clock:[],draws:{},work:[],longTasks:[],skipped:[],drawCalls:0};
      let wasDragging=false,changes=0;const inputValues=[],inputWork=[],inputStart=performance.now();
      const inputTimer=interaction?setInterval(()=>{
        const input=document.getElementById(control);if(!input)return;
        const dragging=interaction!=='bursts'||(performance.now()-inputStart)%1500<1000;
        if(dragging){const min=Number(input.min),max=Number(input.max),step=Number(input.step);input.value=String(min+Math.round((max-min)*(.5+.5*Math.sin(performance.now()/500))/step)*step);const at=performance.now();input.dispatchEvent(new Event('input',{bubbles:true}));inputWork.push({type:'input',at,ms:performance.now()-at});inputValues.push(Number(input.value));}
        else if(wasDragging){const at=performance.now();input.dispatchEvent(new Event('change',{bubbles:true}));inputWork.push({type:'change',at,ms:performance.now()-at});changes++;}
        wasDragging=dragging;
      },100):null;
      const start=performance.now();await new Promise(resolve=>setTimeout(resolve,duration));
      if(inputTimer)clearInterval(inputTimer);
      const elapsed=performance.now()-start,b=window.__bench;
      function stats(times){
        const intervals=times.slice(1).map((t,i)=>t-times[i]);
        const sorted=[...intervals].sort((a,b)=>a-b);
        const percentile=p=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]||0;
        let minFps=Infinity;for(let t=start;t+1000<=start+elapsed;t+=100)minFps=Math.min(minFps,times.filter(v=>v>=t&&v<t+1000).length);
        return {frames:times.length,fps:times.length*1000/elapsed,minRolling1sFps:Number.isFinite(minFps)?minFps:0,p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),maxMs:sorted.at(-1)||0,gapsOver25ms:intervals.filter(v=>v>25).length,gapsOver50ms:intervals.filter(v=>v>50).length,gapDetails:times.slice(1).flatMap((t,i)=>t-times[i]>25?[{at:t,intervalMs:t-times[i]}]:[])};
      }
      const work=[...b.work].sort((a,b)=>a-b);
      return {elapsedMs:elapsed,clock:stats(b.clock),canvases:Object.fromEntries(Object.entries(b.draws).map(([id,times])=>[id,stats(times)])),callbackWorkP95Ms:work[Math.floor(work.length*.95)]||0,callbackWorkMaxMs:work.at(-1)||0,longTasks:b.longTasks,skippedCallbacks:b.skipped,visibility:document.visibilityState,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},canvasBuffers:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height})),interaction:interaction?{control,events:inputValues.length,changes,min:Math.min(...inputValues),max:Math.max(...inputValues),work:inputWork}:null,uiMetrics:document.querySelector('#metrics')?.textContent};
    },{duration,interaction:scenario.interaction||false,control:scenario.control||'wind'});
    if(scenario.enabled&&!Object.keys(measured.canvases).length)throw new Error('Enabled effect produced no frames: '+JSON.stringify(scenario));
    result.results.push({...scenario,actualSettings:actual,...measured});
    if(options.onResult) await options.onResult(result);
    console.log('SCENARIO '+JSON.stringify({mode:scenario.mode,rate:scenario.rate,count:scenario.count,clockFps:measured.clock.fps,canvas:measured.canvases,workP95:measured.callbackWorkP95Ms}));
  }
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  return result;
}
