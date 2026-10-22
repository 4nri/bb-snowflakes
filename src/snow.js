/** Dependency-free snow. All distances are CSS pixels at referenceWidth. */
export const DEFAULTS = Object.freeze({count:40, size:2, sizeVariation:0.8, blur:0.4, speed:28, wind:6, sway:10, opacity:0.65, enabled:true});
const limits = {count:[0,200],size:[0.5,6],sizeVariation:[0,1],blur:[0,1],speed:[0,160],wind:[-100,100],sway:[0,60],opacity:[0,1]};
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
function setDepth(p,variation) {p.depth=1-variation*(1-p.baseDepth);}
// Eight cached soft edges; focus stays sharp between depths 0.45 and 0.8.
export function blurLevelForDepth(depth,strength) {
  const defocus=depth<0.45?(0.45-depth)/0.2*0.45:depth>0.8?(depth-0.8)/0.2:0;
  return strength>0&&defocus>0?Math.max(1,Math.round(Math.min(1,defocus)*strength*8)):0;
}
const CELL=64,SPRITE_LEVELS=8;
let spriteAtlas;
function getSpriteAtlas() {
  if(spriteAtlas)return spriteAtlas;
  const canvas=document.createElement('canvas');canvas.width=CELL;canvas.height=CELL*SPRITE_LEVELS;
  const ctx=canvas.getContext('2d');
  for(let level=1;level<=SPRITE_LEVELS;level++){
    const sigma=level/SPRITE_LEVELS*0.75,support=1+3*sigma;
    const x=CELL/2,y=(level-0.5)*CELL,outer=CELL/2;
    // A radial soft-disc approximation, baked once. No filter/shadowBlur in any frame.
    const peak=1-Math.exp(-1/(2*sigma*sigma));
    const gradient=ctx.createRadialGradient(x,y,0,x,y,outer);
    const stop=(r,alpha)=>gradient.addColorStop(r/support,`rgba(255,255,255,${alpha*peak})`);
    stop(0,1);
    if(1-2*sigma>0)stop(1-2*sigma,.977);
    if(1-sigma>0)stop(1-sigma,.841);
    stop(1,.5);stop(1+sigma,.159);stop(1+2*sigma,.023);stop(support,0);
    ctx.fillStyle=gradient;ctx.fillRect(0,(level-1)*CELL,CELL,CELL);
  }
  return spriteAtlas=canvas; // Shared by every Snow instance: 64 × 512 × 4 = 128 KiB.
}
function styleParticle(p,settings) {
  p.radius=settings.size*p.depth;
  p.blurLevel=blurLevelForDepth(p.depth,settings.blur);
  p.extent=p.radius*(1+3*p.blurLevel/SPRITE_LEVELS*0.75);
}
export function createParticle(width,height,random=Math.random,sizeVariation=DEFAULTS.sizeVariation) {
  const p={x:random()*width,y:random()*height,baseDepth:0.25+random()*0.75,phase:random()*Math.PI*2};
  setDepth(p,sizeVariation);return p;
}
export function stepParticle(p,dt,settings,width,height,time) {
  p.x += settings.wind * p.depth * dt;
  p.y += settings.speed * p.depth * dt;
  const margin = settings.size*(1+2.25*(settings.blur||0)) + settings.sway + 4;
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
    while(this.particles.length<this.settings.count) {
      const p=createParticle(this.width,this.height,Math.random,this.settings.sizeVariation);
      styleParticle(p,this.settings);this.particles.push(p);
    }
    this.particles.length=this.settings.count;
  }
  update(settings) {
    const wasActive=this.active;
    const previous=this.settings;
    this.settings=normalize({...this.settings,...settings});this.syncParticles();
    // Cache the size/speed factor on control changes, never randomize per frame.
    if(this.settings.sizeVariation!==previous.sizeVariation||this.settings.size!==previous.size||this.settings.blur!==previous.blur)
      for(const p of this.particles){setDepth(p,this.settings.sizeVariation);styleParticle(p,this.settings);}
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
      if(p.y<top-p.extent||p.y>bottom+p.extent) continue;
      const x=p.x+Math.sin(this.time*0.7+p.phase)*s.sway*p.depth;
      if(p.blurLevel){
        ctx.drawImage(getSpriteAtlas(),0,(p.blurLevel-1)*CELL,CELL,CELL,x-p.extent,p.y-p.extent,p.extent*2,p.extent*2);
      }else{
        ctx.moveTo(x+p.radius,p.y);ctx.arc(x,p.y,p.radius,0,Math.PI*2);
      }
    }
    ctx.fill(); // All sharp points still share one fill. At blur 0 this is the original path.
    ctx.restore();
  }
  destroy() {
    this.destroyed=true;instances.delete(this);this.resizeObserver.disconnect();this.intersectionObserver.disconnect();
    document.removeEventListener('visibilitychange',this.onVisibility);this.motion.removeEventListener('change',this.onMotion);this.canvas.remove();
    if(!hasActive()&&frame){cancelAnimationFrame(frame);frame=0;}
  }
}
