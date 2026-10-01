/* Measures actual DOM work and exercises bitmap rendering with native Skia.
   Not a browser FPS measurement. NODE_PATH=/private/tmp/shanhe-dom/node_modules node scripts/verify_motion_performance.cjs */
const fs=require('fs'),path=require('path'),assert=require('assert'),{JSDOM}=require('jsdom'),{createRequire}=require('module');
const {installDomClock}=require('./dom_clock.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'previews/historical-atlas-v3/output');
const bundled=createRequire('/Users/yuanzichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/probe.js');
const native=bundled('@napi-rs/canvas'),sharp=bundled('sharp'),windows=[];
function make(source,nativeCanvas=false){
 const w=new JSDOM(fs.readFileSync(path.join(ROOT,'index.html'),'utf8'),{url:'http://127.0.0.1:8765/',runScripts:'outside-only',pretendToBeVisual:true}).window,d=w.document;windows.push(w);
 const clock=installDomClock(w),stats={writes:0,reads:0,paths:0,bitmapDraws:0,saves:0};
 const attr=w.Element.prototype.setAttribute;w.Element.prototype.setAttribute=function(...args){stats.writes++;return attr.apply(this,args);};
 d.getElementById('map').getBoundingClientRect=()=>{stats.reads++;return {width:1440,height:900,left:0,top:0};};
 const save=w.Storage.prototype.setItem;w.Storage.prototype.setItem=function(...args){stats.saves++;return save.apply(this,args);};
 if(nativeCanvas){
  w.Path2D=class extends native.Path2D{constructor(...args){super(...args);stats.paths++;}};
  w.Image=class extends native.Image{set src(url){super.src=fs.readFileSync(path.resolve(ROOT,url));}get src(){return super.src;}};
  for(const key of ['width','height']){const descriptor=Object.getOwnPropertyDescriptor(w.HTMLCanvasElement.prototype,key);Object.defineProperty(w.HTMLCanvasElement.prototype,key,{get:descriptor.get,set(value){descriptor.set.call(this,value);if(this.nativeCanvas)this.nativeCanvas[key]=value;}});}
  w.HTMLCanvasElement.prototype.getContext=function(){
   if(!this.nativeCanvas)this.nativeCanvas=native.createCanvas(this.width,this.height);
   if(!this.proxyContext)this.proxyContext=new Proxy({}, {get:(_,key)=>{
    const context=this.nativeCanvas.getContext('2d'),value=context[key];
    if(key==='drawImage')return (image,...args)=>{stats.bitmapDraws++;return context.drawImage(image.nativeCanvas||image,...args);};
    return typeof value==='function'?value.bind(context):value;
   },set:(_,key,value)=>{this.nativeCanvas.getContext('2d')[key]=value;return true;}});
   return this.proxyContext;
  };
 }
 for(const file of ['vendor/polygon-clipping.umd.min.js','maps/atlas.js','maps/motion-cache.js'])w.eval(fs.readFileSync(path.join(ROOT,file),'utf8'));w.eval(source);
 return {w,d,clock,stats,reset(){for(const key of Object.keys(stats))stats[key]=0;}};
}
function benchmark(t){
 t.d.getElementById('start-btn').click();t.clock.flush();t.reset();const samples=[];
 for(let i=0;i<8;i++){t.d.getElementById(i%2?'zoom-out':'zoom-in').click();for(let j=0;j<22;j++){const start=process.hrtime.bigint();t.clock.step();samples.push(Number(process.hrtime.bigint()-start)/1e6);}t.clock.flush();}
 samples.sort((a,b)=>a-b);return {samples:samples.length,medianMs:samples[Math.floor(samples.length/2)],p95Ms:samples[Math.floor(samples.length*.95)],svgAttributeWrites:t.stats.writes,layoutReads:t.stats.reads};
}
async function exportFrame(t,name){
 const map=t.d.getElementById('map').cloneNode(true);[...map.children].filter(el=>el.id!=='label-layer'&&el.tagName.toLowerCase()!=='defs').forEach(el=>el.remove());map.setAttribute('xmlns','http://www.w3.org/2000/svg');map.setAttribute('width',1440);map.setAttribute('height',900);
 const labels=await sharp(Buffer.from(map.outerHTML)).png().toBuffer();
 await sharp(t.d.getElementById('motion-map').nativeCanvas.toBuffer('image/png')).composite([{input:labels}]).png().toFile(path.join(OUT,name+'.png'));
}
(async()=>{
 const beforeFile=process.argv[2]||'/private/tmp/shanhe-perf-before-game.js';
 const before=fs.existsSync(beforeFile)?benchmark(make(fs.readFileSync(beforeFile,'utf8'))):null;
 const source=fs.readFileSync(path.join(ROOT,'game.js'),'utf8'),after=benchmark(make(source)),checks=[];
 if(before){assert(after.svgAttributeWrites<before.svgAttributeWrites*.45);assert(after.layoutReads<before.layoutReads*.1);checks.push('相同 176 个动画帧的 DOM 写入与布局读取显著减少');}
 const t=make(source,true);t.d.getElementById('start-btn').click();t.clock.flush();await new Promise(resolve=>setTimeout(resolve,80));t.d.getElementById('zoom-in').click();t.clock.step(16);
 assert(t.d.getElementById('map').classList.contains('motion-preview'));assert(t.d.getElementById('motion-map').nativeCanvas);
 await exportFrame(t,'three-motion-cache');t.reset();for(let i=0;i<8;i++)t.clock.step(16);
 assert.equal(t.stats.paths,0);assert(t.stats.bitmapDraws>0);checks.push('移动中复用真实位图，没有逐帧重新构建海岸线和边界路径');
 t.clock.flush();assert(!t.d.getElementById('map').classList.contains('motion-preview'));assert.equal(t.d.getElementById('motion-map').style.display,'none');checks.push('动画停靠后恢复完整矢量地图，缓存画面退出');
 t.reset();for(let i=0;i<50;i++)t.d.getElementById('map').dispatchEvent(new t.w.WheelEvent('wheel',{deltaY:-2,clientX:720,clientY:450,bubbles:true}));
 assert.equal(t.stats.writes,0);assert.equal(t.stats.saves,0);assert.equal(t.clock.pending(),1);t.clock.step(16);t.clock.flush();assert(t.stats.saves<=2);checks.push('50 个连续滚轮事件合并到一个帧任务，存档写入不随事件重复');
 function pointer(type,x,y){const e=new t.w.MouseEvent(type,{clientX:x,clientY:y,button:0,bubbles:true});Object.defineProperty(e,'pointerId',{value:1});return e;}
 const map=t.d.getElementById('map');map.dispatchEvent(pointer('pointerdown',720,450));for(let i=0;i<40;i++)map.dispatchEvent(pointer('pointermove',720+i*2,450+i));t.clock.step(16);
 assert(map.classList.contains('motion-preview'));map.dispatchEvent(pointer('pointerup',800,490));t.clock.flush();assert(!map.classList.contains('motion-preview'));checks.push('平移共用帧队列，抬起鼠标后退出缓存并保留最终镜头');
 t.d.getElementById('new-game-btn').click();t.d.querySelector('[data-scenario="asia"]').click();t.d.getElementById('start-btn').click();t.clock.flush();
 const search=t.d.getElementById('map-search');search.value='浙江省';search.dispatchEvent(new t.w.Event('input'));[...t.d.querySelectorAll('#map-search-results button')].find(b=>b.querySelector('small').textContent.includes('概览区域')).click();t.clock.flush();
 t.d.getElementById('zoom-out').click();t.clock.step(48);await exportFrame(t,'zhejiang-motion-cache');t.clock.flush();checks.push('三国及二战省级视野均通过原生 Canvas 绘制并导出实际画面');
 const result={environment:'jsdom CPU/DOM comparison + native Skia bitmap rendering; not measured browser FPS',before,after,svgWritesReduction:before?1-after.svgAttributeWrites/before.svgAttributeWrites:null,layoutReadsReduction:before?1-after.layoutReads/before.layoutReads:null,passed:checks};
 fs.writeFileSync(path.join(OUT,'motion-performance-checks.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>windows.forEach(w=>w.close()));
