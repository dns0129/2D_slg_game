/* Focused rendering/camera checks for the Three Kingdoms viewport.
   NODE_PATH=/private/tmp/shanhe-dom/node_modules node scripts/verify_three_view.cjs
   SVG export is the real game map, not a browser screenshot. */
const fs=require('fs'),path=require('path'),assert=require('assert'),{JSDOM}=require('jsdom'),{createRequire}=require('module');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'previews/historical-atlas-v3/output'),KEY='shanhe-strategy-save-v3';
const sharp=createRequire('/Users/yuanzichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/probe.js')('sharp');
const windows=[],errors=[],checks=[];
const {installDomClock}=require('./dom_clock.cjs');
function make(width=1440,height=900,saved){
 const w=new JSDOM(fs.readFileSync(path.join(ROOT,'index.html'),'utf8'),{url:'http://127.0.0.1:8765/',runScripts:'outside-only',pretendToBeVisual:true}).window;windows.push(w);installDomClock(w,{autoFlush:true});
 const d=w.document,size={width,height};w.addEventListener('error',e=>errors.push(e.error?.stack||e.message));
 d.getElementById('map').getBoundingClientRect=()=>({...size,left:0,top:0});d.getElementById('map').setPointerCapture=()=>{};d.getElementById('map').hasPointerCapture=()=>false;
 if(saved)w.localStorage.setItem(KEY,JSON.stringify(saved));
 w.eval(fs.readFileSync(path.join(ROOT,'vendor/polygon-clipping.umd.min.js'),'utf8'));w.eval(fs.readFileSync(path.join(ROOT,'maps/atlas.js'),'utf8'));w.eval(fs.readFileSync(path.join(ROOT,'maps/motion-cache.js'),'utf8'));w.eval(fs.readFileSync(path.join(ROOT,'game.js'),'utf8'));
 return {w,d,size,save:()=>JSON.parse(w.localStorage.getItem(KEY)),view:()=>d.getElementById('map').getAttribute('viewBox').split(' ').map(Number)};
}
function click(t,id){t.d.getElementById(id).click();}
async function exportMap(t,name){
 const map=t.d.getElementById('map').cloneNode(true);map.setAttribute('xmlns','http://www.w3.org/2000/svg');map.setAttribute('width',t.size.width*1.5);map.setAttribute('height',t.size.height*1.5);
 for(const el of map.querySelectorAll('image'))el.setAttribute('href','data:image/png;base64,'+fs.readFileSync(path.join(ROOT,el.getAttribute('href'))).toString('base64'));
 const xml=map.outerHTML;fs.writeFileSync(path.join(OUT,name+'.svg'),xml);await sharp(Buffer.from(xml)).png().toFile(path.join(OUT,name+'.png'));
}
function pointer(t,type,x,y){const e=new t.w.MouseEvent(type,{clientX:x,clientY:y,bubbles:true,button:0});Object.defineProperty(e,'pointerId',{value:1});return e;}
(async()=>{
 const t=make();click(t,'start-btn');const s=t.w.SHANHE_ATLAS.scenarios.three,b=t.view(),beforeWidth=Math.max(s.homeBounds[2],s.homeBounds[3]*1.6)*1.02;
 assert(b[2]<beforeWidth*.6);assert.equal(t.d.getElementById('map').dataset.lod,'district');assert.equal(t.d.getElementById('asia-full').textContent,'全域');
 assert(t.d.querySelectorAll('[data-unit]').length>70);assert(t.d.querySelectorAll('[data-label-type="unit"]').length>35);
 for(const name of ['长安','洛阳','成都','武昌'])assert(t.d.querySelector('[data-label="'+name+'"]'),name);
 assert(t.d.querySelector('image[href="./maps/relief-east-asia.png"]').style.display!=='none');
 const detailRivers=t.d.querySelectorAll('#water-layer path').length;
 await exportMap(t,'three-focus');checks.push('默认核心战区线性放大约 2.3 倍；郡界、历史城市和细山体直接显示');
 click(t,'asia-full');const full=t.view();assert.equal(t.d.getElementById('map').dataset.lod,'overview');
 assert.equal(t.d.querySelector('[data-water-detail="district"]').getAttribute('visibility'),'hidden');
 for(const p of s.units)assert(p.bounds[0]>=full[0]-.01&&p.bounds[1]>=full[1]-.01&&p.bounds[0]+p.bounds[2]<=full[0]+full[2]+.01&&p.bounds[1]+p.bounds[3]<=full[1]+full[3]+.01,p.name);
 checks.push('全域保留全部 120 个地块，概览与细分仍可切换');
 click(t,'zoom-reset');assert.deepEqual(t.view(),b);await exportMap(t,'three-focus');
 const snapshots=[];
 for(const [width,height] of [[1920,1080],[2520,1080],[900,1200]]){
  const view=make(width,height);click(view,'start-btn');const vb=view.view();assert(Math.abs(vb[2]/vb[3]-width/height)<.00001);
  assert.equal(view.d.getElementById('map').dataset.lod,'district');for(const name of ['长安','洛阳','成都','武昌'])assert(view.d.querySelector('[data-label="'+name+'"]'),name+' '+width+'x'+height);snapshots.push({size:[width,height],viewBox:vb});
 }
 checks.push('宽屏、超宽屏和竖屏保持地理比例，以核心战区铺满取景');
 t.size.width=1920;t.size.height=1080;t.w.dispatchEvent(new t.w.Event('resize'));await new Promise(r=>setTimeout(r,120));t.w.__mapTestClock.flush();assert(Math.abs(t.view()[2]/t.view()[3]-1920/1080)<.00001);
 assert(t.view()[2]<beforeWidth*.6);checks.push('默认视角随窗口尺寸自动重新取景');
 const old=t.save();delete old.cameraVersion;delete old.cameraAtHome;old.camera={x:600,y:300,w:1000,h:625};old.gold.wei=777;old.turn=5;old.provinces[0].army=333;
 const migrated=make(1440,900,old);assert.deepEqual(migrated.view(),b);assert.equal(migrated.save().gold.wei,777);assert.equal(migrated.save().turn,5);assert.equal(migrated.save().provinces[0].army,333);assert.equal(migrated.save().provinces.length,120);
 checks.push('旧三国存档自动调整取景，保留回合、国库和兵力');
 click(migrated,'zoom-in');const customized=migrated.save(),restored=make(1440,900,customized);assert(restored.view().every((v,i)=>Math.abs(v-migrated.view()[i])<1e-7));
 checks.push('新存档继续恢复玩家自行缩放的视角');
 const map=restored.d.getElementById('map');map.dispatchEvent(pointer(restored,'pointerdown',600,400));map.dispatchEvent(pointer(restored,'pointermove',6000,6000));map.dispatchEvent(pointer(restored,'pointerup',6000,6000));await new Promise(r=>setTimeout(r,30));const pan=restored.view();
 const overlaps=s.units.filter(p=>p.bounds[0]<pan[0]+pan[2]&&p.bounds[0]+p.bounds[2]>pan[0]&&p.bounds[1]<pan[1]+pan[3]&&p.bounds[1]+p.bounds[3]>pan[1]);assert(overlaps.length>0);
 for(let i=0;i<14;i++)click(restored,'zoom-out');assert(restored.view()[2]<600);checks.push('平移及最大缩小范围围绕三国战区，避免进入空白的亚洲外围');
 assert.equal(errors.length,0,errors.join('\n'));const report={environment:'jsdom camera/DOM checks + actual SVG rendering (not browser UX)',passed:checks,defaultViewBox:b,oldDefaultWidth:beforeWidth,linearEnlargement:beforeWidth/b[2],visibleUnits:t.d.querySelectorAll('[data-unit]').length,detailWaterPaths:detailRivers,snapshots,errors};fs.writeFileSync(path.join(OUT,'three-view-checks.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>windows.forEach(w=>w.close()));
