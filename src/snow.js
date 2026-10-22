/** Dependency-free snow. All distances are CSS pixels at referenceWidth. */
export const DEFAULTS = Object.freeze({count:40, size:2, speed:28, wind:6, sway:10, opacity:0.65, enabled:true});
const limits = {count:[0,200],size:[0.5,6],speed:[0,160],wind:[-100,100],sway:[0,60],opacity:[0,1]};
export function normalize(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Settings must be an object');
  const result = {...DEFAULTS};
  for(const [key,[min,max]] of Object.entries(limits)) {
    const value = input[key];
    if(typeof value === 'number' && Number.isFinite(value)) result[key] = Math.max(min,Math.min(max,value));
  }
  result.count = Math.round(result.count);
  if(typeof input.enabled === 'boolean') result.enabled = input.enabled;
  return result;
}
export function createParticle(width,height,random=Math.random) {
  return {x:random()*width,y:random()*height,depth:0.35+random()*0.65,phase:random()*Math.PI*2};
}
export function stepParticle(p,dt,settings,width,height,time) {
  p.x += settings.wind * p.depth * dt;
  p.y += settings.speed * p.depth * dt;
  const margin = settings.size + settings.sway + 4;
  if(p.y > height+margin) p.y = -margin;
  if(p.x > width+margin) p.x = -margin;
  if(p.x < -margin) p.x = width+margin;
  return p.x;
}

// One scheduler for every instance, no timers when all instances are idle.
const instances = new Set();
let frame = 0;
function tick(now) {
  frame = 0;
  for(const item of instances) if(item.active) item.render(now);
  schedule();
}
function hasActive() {for(const item of instances) if(item.active) return true;return false;}
function schedule() {
  if(!frame && hasActive()) frame=requestAnimationFrame(tick);
}
export class Snow {
  constructor(container, settings={}, options={}) {
    this.container=container;
    this.settings=normalize(settings);
    this.referenceWidth=options.referenceWidth||393;
    this.onFrame=options.onFrame;
    this.clip=options.clip||[0,Infinity];
    this.paused=false;this.visible=true;this.destroyed=false;this.time=0;this.last=0;this.frames=0;this.measuredFps=0;
    this.canvas=document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden','true');
    Object.assign(this.canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'});
    container.append(this.canvas);
    this.ctx=this.canvas.getContext('2d',{alpha:true});
    this.particles=[];
    this.motion=matchMedia('(prefers-reduced-motion: reduce)');
    this.respectMotion=true;
    this.onVisibility=()=>this.refresh();
    this.onMotion=()=>this.refresh();
    document.addEventListener('visibilitychange',this.onVisibility);
    this.motion.addEventListener('change',this.onMotion);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);
    this.intersectionObserver=new IntersectionObserver(entries=>{this.visible=entries[0].isIntersecting;this.refresh();});
    this.intersectionObserver.observe(container);
    instances.add(this);this.resize();this.refresh();
  }
  get active() {return !this.destroyed && this.visible && !document.hidden && !this.paused && this.settings.enabled && this.settings.count>0 && !(this.respectMotion&&this.motion.matches);}
  resize() {
    const {width,height}=this.container.getBoundingClientRect();
    if(!width||!height) return;
    this.width=this.referenceWidth;this.height=height/width*this.width;
    const dpr=1; // Deliberately avoid Retina buffers for this decorative layer.
    this.canvas.width=Math.round(width*dpr);this.canvas.height=Math.round(height*dpr);
    this.ctx.setTransform(this.canvas.width/this.width,0,0,this.canvas.height/this.height,0,0);
    this.syncParticles();this.draw();this.refresh();
  }
  syncParticles() {
    while(this.particles.length<this.settings.count) this.particles.push(createParticle(this.width,this.height));
    this.particles.length=this.settings.count;
  }
  update(settings) {
    const wasActive=this.active;
    this.settings=normalize({...this.settings,...settings});this.syncParticles();
    // An active animation draws the latest values on its next scheduled frame.
    if(!this.active||!wasActive)this.draw();
    if(this.active&&wasActive)schedule();else this.refresh();
  }
  setClip(top,bottom) {this.clip=[top,bottom];if(!this.active)this.draw();}
  pause() {this.paused=true;this.refresh();}
  play({ignoreReducedMotion=false}={}) {
    const wasActive=this.active;this.paused=false;this.respectMotion=!ignoreReducedMotion;
    if(!wasActive&&this.active)this.refresh();else schedule();
  }
  refresh() {this.last=0;this.lastCallback=0;this.nextFrame=0;this.measureStart=0;this.frames=0;this.measuredFps=0;schedule();}
  render(now) {
    const callbackInterval=this.lastCallback?now-this.lastCallback:0;
    this.lastCallback=now;
    if(!this.last) {this.last=now;this.nextFrame=now+1000/60;this.draw();return;}
    // Follow every display frame around 60 Hz. Only cap genuinely faster displays.
    // A phase-locked 60 Hz cap otherwise drops frames when clock rates differ slightly.
    if(callbackInterval<14 && now+0.5<this.nextFrame) return;
    this.nextFrame=callbackInterval>=14?now+1000/60:this.nextFrame+1000/60;
    if(this.nextFrame<now) this.nextFrame=now+1000/60;
    const started=this.onFrame?performance.now():0;
    const dt=Math.min((now-this.last)/1000,0.05);this.last=now;this.time+=dt;
    for(const p of this.particles) stepParticle(p,dt,this.settings,this.width,this.height,this.time);
    this.draw();
    if(this.onFrame) this.onFrame(performance.now()-started);
    if(!this.measureStart) this.measureStart=now;
    this.frames++;
    if(now-this.measureStart>=1000) {this.measuredFps=Math.round(this.frames*1000/(now-this.measureStart));this.frames=0;this.measureStart=now;}
  }
  draw() {
    const ctx=this.ctx,s=this.settings;
    ctx.clearRect(0,0,this.width,this.height);
    if(!s.enabled||!s.count) return;
    const top=this.clip[0],bottom=Math.min(this.height,this.clip[1]);
    ctx.save();ctx.beginPath();ctx.rect(0,top,this.width,Math.max(0,bottom-top));ctx.clip();
    ctx.globalAlpha=s.opacity;ctx.fillStyle='#fff';ctx.beginPath();
    for(const p of this.particles) {
      if(p.y<top-s.size||p.y>bottom+s.size) continue;
      const x=p.x+Math.sin(this.time*0.7+p.phase)*s.sway*p.depth;
      const radius=s.size*(0.6+p.depth*0.4);
      ctx.moveTo(x+radius,p.y);ctx.arc(x,p.y,radius,0,Math.PI*2);
    }
    ctx.fill(); // One fill call for every particle in this canvas.
    ctx.restore();
  }
  destroy() {
    this.destroyed=true;instances.delete(this);this.resizeObserver.disconnect();this.intersectionObserver.disconnect();
    document.removeEventListener('visibilitychange',this.onVisibility);this.motion.removeEventListener('change',this.onMotion);this.canvas.remove();
    if(!hasActive()&&frame){cancelAnimationFrame(frame);frame=0;}
  }
}
