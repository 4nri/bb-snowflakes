import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalize,DEFAULTS,createParticle,stepParticle} from '../src/snow.js';
test('external settings cannot exceed the resource budget',()=>{
  const actual=normalize({count:100000,size:-1,speed:Infinity,wind:-1000,opacity:NaN,shape:'unknown',fps:144,enabled:'false'});
  assert.equal(actual.count,200);assert.equal(actual.size,0.5);assert.equal(actual.speed,DEFAULTS.speed);assert.equal(actual.wind,-100);assert.equal(actual.opacity,DEFAULTS.opacity);assert.equal(actual.shape,undefined);assert.equal(actual.fps,undefined);assert.equal(actual.enabled,true);
});
test('reject malformed settings containers',()=>{for(const input of [null,[],true,'oops'])assert.throws(()=>normalize(input),TypeError);});
test('size variation accepts old settings and clamps untrusted values',()=>{
  assert.equal(normalize({size:3}).sizeVariation,DEFAULTS.sizeVariation);
  assert.equal(normalize({sizeVariation:-1}).sizeVariation,0);
  assert.equal(normalize({sizeVariation:10}).sizeVariation,1);
  for(const value of [NaN,Infinity,'1',null])assert.equal(normalize({sizeVariation:value}).sizeVariation,DEFAULTS.sizeVariation);
});
test('zero particles and zero motion remain valid',()=>{const result=normalize({count:0,speed:0,wind:0,sway:0,opacity:0,enabled:false});assert.equal(result.count,0);assert.equal(result.opacity,0);assert.equal(result.speed,0);assert.equal(result.enabled,false);});
test('particle generation stays inside the viewport',()=>{const p=createParticle(393,852,()=>0.5);assert.equal(p.x,196.5);assert.equal(p.y,426);assert.ok(p.depth>=.35&&p.depth<=1);});
test('motion over one second matches at 30 and 60 fps',()=>{
  const a=createParticle(393,852,()=>.2),b={...a};
  for(let i=0;i<30;i++)stepParticle(a,1/30,DEFAULTS,393,852,i/30);
  for(let i=0;i<60;i++)stepParticle(b,1/60,DEFAULTS,393,852,i/60);
  assert.ok(Math.abs(a.x-b.x)<1e-9);assert.ok(Math.abs(a.y-b.y)<1e-9);
});
test('large near particles move four times faster at full variation; zero variation is uniform',()=>{
  for(const variation of [0,1]){
    const far=createParticle(393,852,()=>0,variation),near=createParticle(393,852,()=>1,variation);
    for(const p of [far,near]){p.x=100;p.y=100;stepParticle(p,1,DEFAULTS,393,852,1);}
    const ratio=variation===1?4:1;
    assert.equal((near.y-100)/(far.y-100),ratio);
    assert.equal((near.x-100)/(far.x-100),ratio);
    assert.equal(near.depth/far.depth,ratio);
  }
});
test('particles recycle at bottom and wind boundaries',()=>{
  const p={x:10000,y:10000,depth:1,phase:0};stepParticle(p,1/60,DEFAULTS,393,852,0);assert.ok(p.x<0);assert.ok(p.y<0);
});
test('Snow stops rendering for reduced motion, hidden tabs and destroyed containers',async()=>{
  const {Snow}=await import('../src/snow.js');
  const radii=[];let fills=0;
  const ctx={setTransform(){},clearRect(){radii.length=0;fills=0;},beginPath(){},arc(x,y,radius){radii.push(radius);},fill(){fills++;},translate(){},rotate(){},moveTo(){},lineTo(){},stroke(){},save(){},restore(){},rect(){},clip(){},drawImage(){}};
  const listeners=new Map();let removed=0,pending=new Map(),sequence=0;
  globalThis.document={hidden:false,addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:k=>listeners.delete(k),createElement:()=>({style:{},setAttribute(){},getContext:()=>ctx,remove(){removed++;}})};
  const media={matches:true,addEventListener(){},removeEventListener(){}};
  globalThis.matchMedia=()=>media;globalThis.devicePixelRatio=3;
  globalThis.ResizeObserver=class{observe(){}disconnect(){}};
  let observer;
  globalThis.IntersectionObserver=class{constructor(callback){observer=callback;}observe(){}disconnect(){}};
  globalThis.requestAnimationFrame=callback=>{const id=++sequence;pending.set(id,callback);return id;};
  globalThis.cancelAnimationFrame=id=>pending.delete(id);
  function flush(time){const callbacks=[...pending.values()];pending.clear();callbacks.forEach(callback=>callback(time));}
  const container={append(){},getBoundingClientRect:()=>({width:393,height:852})};
  const snow=new Snow(container,{count:2,size:4,sizeVariation:1,sway:0});
  assert.equal(snow.active,false);assert.equal(pending.size,0);
  const particles=[...snow.particles];particles[0].baseDepth=.25;particles[1].baseDepth=1;
  const positions=particles.map(p=>[p.x,p.y,p.phase,p.baseDepth]);
  snow.update({sizeVariation:0});assert.deepEqual(radii,[4,4]);assert.equal(fills,1,'Still one fill for every point');
  snow.update({sizeVariation:1});assert.deepEqual(radii,[1,4]);
  snow.update({sizeVariation:.5});assert.deepEqual(radii,[2.5,4]);
  snow.update({sizeVariation:1});assert.deepEqual(radii,[1,4],'Stable distribution after changing back');
  assert.ok(particles.every((p,i)=>p===snow.particles[i]),'Slider keeps existing particle objects');
  assert.deepEqual(particles.map(p=>[p.x,p.y,p.phase,p.baseDepth]),positions,'No random resets or position jumps');
  snow.update({sizeVariation:0,count:3});assert.equal(snow.particles[2].depth,1,'New particles use current variation');
  snow.update({count:2,sizeVariation:1});
  snow.play({ignoreReducedMotion:true});assert.equal(snow.active,true);assert.equal(pending.size,1);
  assert.equal(snow.canvas.width,393,'No Retina buffer even on DPR 3');
  const draw=snow.draw.bind(snow);let immediateDraws=0;snow.draw=()=>{immediateDraws++;draw();};
  snow.measuredFps=60;snow.last=100;snow.update({wind:50});snow.setClip(98,818);snow.play({ignoreReducedMotion:true});
  assert.equal(immediateDraws,0,'Active control changes wait for the existing frame instead of drawing repeatedly');
  assert.equal(snow.measuredFps,60,'Control changes do not reset the FPS sample');
  assert.equal(snow.last,100,'Control changes preserve the animation clock');
  document.hidden=true;listeners.get('visibilitychange')();flush(100);assert.equal(pending.size,0);
  document.hidden=false;listeners.get('visibilitychange')();assert.equal(pending.size,1);
  observer([{isIntersecting:false}]);flush(200);assert.equal(pending.size,0);
  observer([{isIntersecting:true}]);assert.equal(pending.size,1);
  snow.pause();flush(300);assert.equal(pending.size,0);
  snow.play();assert.equal(pending.size,0,'play respects reduced motion again');
  snow.play({ignoreReducedMotion:true});snow.destroy();assert.equal(pending.size,0);assert.equal(removed,1);assert.equal(listeners.size,0);
});

test('60 Hz clock drift never introduces an artificial missing frame',async()=>{
  const {Snow}=await import('../src/snow.js');
  for(const hz of [59.94,60,60.1,61]){
    let draws=0;const effect={last:0,lastCallback:0,nextFrame:0,time:0,particles:[],settings:DEFAULTS,frames:0,measureStart:0,draw(){draws++;}};
    for(let i=1;i<=3600;i++)Snow.prototype.render.call(effect,Math.round((1000+i*1000/hz)*10)/10);
    assert.equal(draws,3600,'Every display frame must be drawn at '+hz+' Hz');
  }
});
test('fast displays remain capped near 60 draws per second',async()=>{
  const {Snow}=await import('../src/snow.js');
  for(const hz of [75,90,120,144]){
    let draws=0;const effect={last:0,lastCallback:0,nextFrame:0,time:0,particles:[],settings:DEFAULTS,frames:0,measureStart:0,draw(){draws++;}};
    for(let i=1;i<=hz*10;i++)Snow.prototype.render.call(effect,1000+i*1000/hz);
    assert.ok(draws>=599&&draws<=601,'60 FPS cap at '+hz+' Hz, actual '+draws);
  }
});
