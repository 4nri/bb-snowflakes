import {Snow, DEFAULTS, normalize} from './snow.js';
const $=id=>document.getElementById(id);
const presets={light:{...DEFAULTS},snow:{...DEFAULTS,count:70,size:2.5,speed:42,wind:12,sway:16,opacity:.7},blizzard:{...DEFAULTS,count:110,size:2,speed:85,wind:60,sway:20,opacity:.7}};
const motion=matchMedia('(prefers-reduced-motion: reduce)');
let settings={...DEFAULTS},area='content',paused=motion.matches,preset='light',toastTimer;
function unpack(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('Bad configuration');
  const input=value.settings??value;
  if(!input||typeof input!=='object'||Array.isArray(input)||!Object.keys(DEFAULTS).some(key=>Object.hasOwn(input,key))) throw new Error('Not snow settings');
  return {settings:normalize(input),area:value.area==='hero'?'hero':'content'};
}
let restored=false;
try {
  const hash=new URLSearchParams(location.hash.slice(1));
  const shared=hash.get('snow');
  const saved=shared||localStorage.getItem('bb-snow-settings-v1');
  if(saved){const value=unpack(JSON.parse(saved));settings=value.settings;area=value.area;restored=true;}
} catch {notify('Не удалось прочитать настройки. Загружен лёгкий снег.');}
if(restored) preset=Object.keys(presets).find(key=>JSON.stringify(settings)===JSON.stringify(presets[key]))||null;
const renderSamples=[];
const effects=[$('start-screen'),$('main-screen')].map(el=>new Snow(el,settings,{referenceWidth:393,onFrame:ms=>{renderSamples.push(ms);if(renderSamples.length>240)renderSamples.shift();}}));
const ranges=['count','size','opacity','speed','wind','sway'];
function payload(){return {version:1,settings:{...settings},area};}
function notify(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
function persist(){try{localStorage.setItem('bb-snow-settings-v1',JSON.stringify(payload()));if(new URLSearchParams(location.hash.slice(1)).has('snow'))history.replaceState(null,'','#'+new URLSearchParams({snow:JSON.stringify(payload())}));}catch{/* Storage is optional. */}}
function updateClips(){effects.forEach((e,i)=>e.setClip(98,area==='hero'?(i===0?500:750):818));}
function sync() {
  renderSamples.length=0;
  ranges.forEach(key=>{
    const input=$(key);input.value=settings[key];
    input.style.setProperty('--progress',`${(settings[key]-Number(input.min))/(Number(input.max)-Number(input.min))*100}%`);
    const value=key==='opacity'?`${Math.round(settings[key]*100)}%`:key==='size'||key==='sway'?`${settings[key]} px`:key==='speed'||key==='wind'?`${settings[key]>0&&key==='wind'?'+':''}${settings[key]} px/с`:`${settings[key]}`;
    $(key+'-value').textContent=value;
    input.setAttribute('aria-valuetext',value);
  });
  $('enabled').checked=settings.enabled;$('area').value=area;
  document.querySelectorAll('[data-preset]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.preset===preset)));
  $('custom-label').hidden=!!preset;
  document.querySelectorAll('.parameters').forEach(el=>el.classList.toggle('dimmed',!settings.enabled));
  effects.forEach(e=>e.update(settings));updateClips();
  updatePlayback();persist();
}
function updatePlayback() {
  const button=$('pause');
  button.replaceChildren();
  const icon=document.createElement('span');icon.setAttribute('aria-hidden','true');icon.textContent=paused?'▶':'Ⅱ';
  button.append(icon,paused?' Запустить':' Пауза');
  button.disabled=!settings.enabled||settings.count===0;
  $('state-label').textContent=!settings.enabled?'Снег выключен':settings.count===0?'Нет частиц':paused?'На паузе':'Снег идёт';
  $('live-dot').classList.toggle('idle',paused||!settings.enabled||settings.count===0);
  $('motion-notice').hidden=!(motion.matches&&paused&&settings.enabled);
  effects.forEach(e=>paused?e.pause():e.play({ignoreReducedMotion:true}));
  updateMetrics();
}
function updateMetrics(){const fps=effects.find(e=>e.active)?.measuredFps||0;const sorted=[...renderSamples].sort((a,b)=>a-b);const p95=sorted[Math.floor(sorted.length*.95)]||0;$('metrics').textContent=`${settings.enabled?settings.count*2:0} точек · ${fps} FPS · ${p95.toFixed(2)} мс`;$('metrics').title='Время расчёта и отрисовки одного экрана, 95-й процентиль. Частота зависит от устройства и браузера.';}
for(const key of ranges) $(key).addEventListener('input',()=>{
  const value=ranges.includes(key)?Number($(key).value):$(key).value;
  settings=normalize({...settings,[key]:value});preset=null;sync();
});
$('enabled').addEventListener('change',()=>{settings.enabled=$('enabled').checked;sync();});
$('area').addEventListener('change',()=>{area=$('area').value;updateClips();persist();});
document.querySelectorAll('[data-preset]').forEach(el=>el.addEventListener('click',()=>{preset=el.dataset.preset;settings={...presets[preset]};sync();}));
$('pause').addEventListener('click',()=>{paused=!paused;updatePlayback();});
motion.addEventListener('change',event=>{if(event.matches){paused=true;updatePlayback();}});
$('reset').addEventListener('click',()=>{settings={...DEFAULTS};area='content';preset='light';paused=motion.matches;sync();notify('Настройки сброшены');});
$('export').addEventListener('click',()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload(),null,2)+'\n'],{type:'application/json'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download='bb-snow-settings.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Настройки сохранены в JSON');
});
$('import').addEventListener('click',()=>$('file').click());
$('file').addEventListener('change',async()=>{
  const file=$('file').files[0];if(!file)return;
  try{if(file.size>100000)throw new Error('Too large');const value=unpack(JSON.parse(await file.text()));settings=value.settings;area=value.area;preset=null;sync();notify('Настройки загружены');}
  catch{notify('Не удалось загрузить JSON. Выберите файл настроек снега.');}
  $('file').value='';
});
$('share').addEventListener('click',async()=>{
  const url=new URL(location.href);url.hash=new URLSearchParams({snow:JSON.stringify(payload())}).toString();
  history.replaceState(null,'',url);
  notify('Ссылка с настройками в адресной строке. Её можно скопировать.');
  try{await navigator.clipboard.writeText(url.href);notify('Ссылка с настройками скопирована');}
  catch{/* The address bar remains a reliable copy fallback. */}
});
function fit() {
  const scroll=$('preview-scroll');const zoom=$('zoom').value;
  const availableHeight=Math.max(300,scroll.clientHeight-61);
  const narrow=innerWidth<=700;
  const availableWidth=narrow?Math.min(330,scroll.clientWidth-54):Math.max(210,(scroll.clientWidth-104)/2);
  const width=zoom==='auto'?Math.max(160,Math.min(393,availableWidth,availableHeight*393/852)):393*Number(zoom);
  document.documentElement.style.setProperty('--screen-width',`${width}px`);
}
$('zoom').addEventListener('change',fit);
new ResizeObserver(fit).observe($('preview-scroll'));
window.addEventListener('resize',fit);
$('fullscreen').addEventListener('click',async()=>{
  const workspace=document.querySelector('.workspace');
  try{if(document.fullscreenElement)await document.exitFullscreen();else if(workspace.requestFullscreen)await workspace.requestFullscreen();else workspace.classList.toggle('presentation');}
  catch{workspace.classList.toggle('presentation');}
  updateFullscreen();
});
function updateFullscreen(){const expanded=!!document.fullscreenElement||document.querySelector('.workspace').classList.contains('presentation');$('fullscreen').setAttribute('aria-label',expanded?'Выйти из полноэкранного просмотра':'Полноэкранный просмотр');$('fullscreen').title=$('fullscreen').getAttribute('aria-label');fit();}
document.addEventListener('fullscreenchange',updateFullscreen);
window.addEventListener('keydown',e=>{if(e.key==='Escape'){document.querySelector('.workspace').classList.remove('presentation');updateFullscreen();}});
for(const img of document.querySelectorAll('.phone img')) img.addEventListener('error',()=>notify('Макет не загрузился. Обновите страницу.'));
sync();fit();
// Diagnostics update once per second, independently of animation render rate.
setInterval(()=>{if(!document.hidden)updateMetrics();},1000);
