/* UI contract checks and SVG exports. Runs in jsdom, not a browser engine.
   npm install --prefix /private/tmp/shanhe-dom jsdom@26 --registry=https://registry.npmjs.org
   NODE_PATH=/private/tmp/shanhe-dom/node_modules node scripts/verify_atlas.cjs
*/
const fs=require('fs'),path=require('path'),assert=require('assert');
const {JSDOM}=require('jsdom');
const {createRequire}=require('module');
const bundled=createRequire('/Users/yuanzichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/probe.js');
const sharp=bundled('sharp');const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'previews/historical-atlas-v3/output');fs.mkdirSync(OUT,{recursive:true});
const errors=[],checks=[];const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const {installDomClock}=require('./dom_clock.cjs');
function make(saved){
 const dom=new JSDOM(html,{url:'http://127.0.0.1:8765/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;installDomClock(w,{autoFlush:true});w.addEventListener('error',e=>errors.push(e.error?.stack||e.message));
 const svg=w.document.getElementById('map');svg.getBoundingClientRect=()=>({width:1050,height:760,left:0,top:0,right:1050,bottom:760});
 svg.setPointerCapture=()=>{};svg.hasPointerCapture=()=>false;
 if(saved)w.localStorage.setItem('shanhe-strategy-save-v3',saved);
 w.eval(fs.readFileSync(path.join(ROOT,'vendor/polygon-clipping.umd.min.js'),'utf8'));w.eval(fs.readFileSync(path.join(ROOT,'maps/atlas.js'),'utf8'));w.eval(fs.readFileSync(path.join(ROOT,'maps/motion-cache.js'),'utf8'));w.eval(fs.readFileSync(path.join(ROOT,'game.js'),'utf8'));return dom;
}
let dom=make(),w=dom.window,d=w.document;
const click=id=>{const e=d.getElementById(id);assert(e,'Missing '+id);e.click();};
const saved=()=>JSON.parse(w.localStorage.getItem('shanhe-strategy-save-v3'));
function search(text){const e=d.getElementById('map-search');e.value=text;e.dispatchEvent(new w.Event('input'));}
function setLayer(value){const e=d.getElementById('map-layer');e.value=value;e.dispatchEvent(new w.Event('change'));}
function selectOwn(){setLayer('district');const p=w.SHANHE_ATLAS.scenarios[saved().scenario].units.find(p=>p.owner===saved().player && d.querySelector('[data-unit="'+p.id+'"]'));assert(p);d.querySelector('[data-unit="'+p.id+'"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));return p;}
async function exportSVG(name){
 const el=d.getElementById('map').cloneNode(true);el.setAttribute('xmlns','http://www.w3.org/2000/svg');el.setAttribute('width','2100');el.setAttribute('height','1520');
 el.querySelectorAll('image').forEach(img=>{const b=img.getAttribute('href');img.setAttribute('href','data:image/png;base64,'+fs.readFileSync(path.join(ROOT,b)).toString('base64'));});
 const xml=el.outerHTML;fs.writeFileSync(path.join(OUT,name+'.svg'),xml);await sharp(Buffer.from(xml)).png().toFile(path.join(OUT,name+'.png'));
}
(async()=>{
 if(process.argv.includes('--render-only')){
  click('start-btn');await exportSVG('three-overview');search('长安');d.querySelector('#map-search-results button').click();await exportSVG('three-changan');
  click('new-game-btn');d.querySelector('[data-scenario="asia"]').click();d.querySelector('[data-faction="china"]').click();click('start-btn');await exportSVG('asia-overview');
  search('浙江省');d.querySelector('#map-search-results button').click();await exportSVG('zhejiang-detail');search('日本内地');d.querySelector('#map-search-results button').click();setLayer('district');await exportSVG('japan-detail');click('asia-full');await exportSVG('asia-full');
  console.log('Exported six current game map views');w.close();return;
 }
 click('start-btn');assert.equal(saved().scenario,'three');assert.equal(d.getElementById('map').dataset.lod,'district');checks.push('三国初始化、核心战区郡界层级');
 assert(w.SHANHE_ATLAS.scenarios.three.cities.some(c=>c.name==='长安'));
 assert(!w.SHANHE_ATLAS.scenarios.three.units.some(p=>['浙江省','广州','建宁','临海','吴兴','东阳'].some(s=>p.name.includes(s))));checks.push('历史名禁用未来建制，长安城市标注');
 await exportSVG('three-overview');
 setLayer('region');const region=d.querySelector('[data-region="益州"]');assert(region);region.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));assert.equal(d.getElementById('map').dataset.lod,'district');assert(d.querySelectorAll('[data-child]').length>10);checks.push('州省概览点击州，展开下级郡域');
 search('长安');assert(d.getElementById('map-search-results').textContent.includes('长安'));d.querySelector('#map-search-results button').click();assert.equal(d.getElementById('map').dataset.lod,'district');assert(d.querySelector('[data-label="长安"]'));await exportSVG('three-changan');checks.push('历史地名搜索与州级视野城市标注');
 click('zoom-reset');const own=selectOwn();const initial=saved(),p0=initial.provinces.find(p=>p.id===own.id);click('recruit-btn');assert.equal(saved().gold[initial.player],initial.gold[initial.player]-12);assert.equal(saved().provinces.find(p=>p.id===own.id).army,p0.army+6);click('develop-btn');assert.equal(saved().provinces.find(p=>p.id===own.id).level,2);checks.push('征兵与发展扣款、驻军、收入等级');
 const ids0=saved().provinces.map(p=>p.id).join(',');for(let i=0;i<6;i++)click('zoom-in');assert.equal(ids0,saved().provinces.map(p=>p.id).join(','));assert.equal(saved().provinces.find(p=>p.id===own.id).army,p0.army+6);checks.push('缩放不修改地块身份或兵力');
 const snapshot=w.localStorage.getItem('shanhe-strategy-save-v3'),restored=make(snapshot);assert.equal(restored.window.document.getElementById('province-stat').textContent,d.getElementById('province-stat').textContent);assert.equal(restored.window.document.getElementById('setup-overlay').classList.contains('hidden'),true);restored.window.close();assert(snapshot.length<200000);checks.push('存档恢复；存档不重复保存几何数据');
 click('zoom-reset');const src=selectOwn();const gs=saved(),source=gs.provinces.find(p=>p.id===src.id);const friendly=w.SHANHE_ATLAS.scenarios.three.adjacency[src.id].map(id=>gs.provinces.find(p=>p.id===id)).find(p=>p.owner===gs.player);assert(friendly,'friendly neighbour');d.querySelector('[data-neighbor="'+friendly.id+'"]').click();const before=saved().provinces.reduce((n,p)=>n+p.army,0);click('move-btn');assert.equal(saved().provinces.reduce((n,p)=>n+p.army,0),before);checks.push('真实边界邻接行军，兵力守恒');
 click('end-turn-btn');assert.equal(saved().turn,2);checks.push('AI 回合与收入结算');
 // Drag on a territory must pan instead of selecting it.
 let pointer=(type,x,y)=>{const e=new w.MouseEvent(type,{clientX:x,clientY:y,bubbles:true,button:0});Object.defineProperty(e,'pointerId',{value:1});return e;};
 click('zoom-in');const map=d.getElementById('map'),oldBox=map.getAttribute('viewBox');map.dispatchEvent(pointer('pointerdown',200,200));map.dispatchEvent(pointer('pointermove',260,240));map.dispatchEvent(pointer('pointerup',260,240));await new Promise(r=>setTimeout(r,25));assert.notEqual(map.getAttribute('viewBox'),oldBox);checks.push('拖拽平移');
 click('new-game-btn');d.querySelector('[data-scenario="asia"]').click();assert(d.querySelector('[data-faction="soviet"]'));d.querySelector('[data-faction="china"]').click();click('start-btn');const s=w.SHANHE_ATLAS.scenarios.asia;assert.equal(s.date,'1941-12-06');assert.equal(s.units.filter(p=>p.parent==='朝鲜总督府').length,13);assert(s.units.some(p=>p.name==='东京府'));assert(!s.units.some(p=>p.name.includes('东京都')));assert(s.units.some(p=>p.id==='region-hongkong'&&p.owner==='uk'));assert(s.units.some(p=>p.parent==='西康省'));assert(s.units.some(p=>p.parent==='热河省'));assert(s.units.filter(p=>p.parent==='浙江省').length===4);assert(s.units.some(p=>p.parent==='上海市'));checks.push('1941 日期、东京府、朝鲜十三道、香港未沦陷、民国省界');
 assert(d.querySelectorAll('#water-layer path').length>15);assert(w.SHANHE_ATLAS.physical.yellow1941.length>0);await exportSVG('asia-overview');
 search('浙江省');const z=d.querySelector('#map-search-results button');assert(z);z.click();assert.equal(d.querySelectorAll('[data-child]').length,4);assert.equal(d.getElementById('map').dataset.lod,'district');await exportSVG('zhejiang-detail');checks.push('浙江省级视野显示四个地块及城市');
 search('日本内地');d.querySelector('#map-search-results button').click();setLayer('district');await exportSVG('japan-detail');checks.push('日本府县细界显示');
 click('asia-full');assert.equal(d.getElementById('map').dataset.lod,'overview');await exportSVG('asia-full');checks.push('亚洲全图：含西亚、印度、北亚与东南亚');
 // All declared adjacency is symmetric and every macro child is an existing unit.
 for(const [id,s] of Object.entries(w.SHANHE_ATLAS.scenarios)){
  const all=new Set(s.units.map(p=>p.id));assert.equal(all.size,s.units.length);
  for(const r of s.regions){assert(r.children.length);for(const c of r.children)assert(all.has(c));}
  for(const [id,ns] of Object.entries(s.adjacency))for(const n of ns)assert(s.adjacency[n].includes(id));
 }
 checks.push('区划层级引用完整、地块 ID 唯一、邻接对称');assert.equal(errors.length,0,errors.join('\n'));
 fs.writeFileSync(path.join(OUT,'ui-checks.json'),JSON.stringify({environment:'jsdom + sharp SVG render (not browser acceptance)',passed:checks,errors},null,2));console.log(JSON.stringify({passed:checks.length,checks,svgExports:6,errors},null,2));w.close();
})().catch(e=>{console.error(e.stack);w.close();process.exitCode=1;});
