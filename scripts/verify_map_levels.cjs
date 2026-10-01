/* Country -> province hierarchy and province-sized maximum zoom.
   NODE_PATH=/private/tmp/shanhe-dom/node_modules node scripts/verify_map_levels.cjs
   Uses jsdom + real SVG exports; not browser interaction acceptance. */
const fs=require('fs'),path=require('path'),assert=require('assert'),{JSDOM}=require('jsdom'),{createRequire}=require('module');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'previews/historical-atlas-v3/output'),KEY='shanhe-strategy-save-v3';
const sharp=createRequire('/Users/yuanzichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/probe.js')('sharp');const windows=[],checks=[],errors=[];
const {installDomClock}=require('./dom_clock.cjs');
function make(saved){
 const w=new JSDOM(fs.readFileSync(path.join(ROOT,'index.html'),'utf8'),{url:'http://127.0.0.1:8765/',runScripts:'outside-only',pretendToBeVisual:true}).window,d=w.document,size={width:1440,height:900};windows.push(w);installDomClock(w,{autoFlush:true});
 w.addEventListener('error',e=>errors.push(e.error?.stack||e.message));d.getElementById('map').getBoundingClientRect=()=>({...size,left:0,top:0});
 if(saved)w.localStorage.setItem(KEY,JSON.stringify(saved));for(const file of ['vendor/polygon-clipping.umd.min.js','maps/atlas.js','maps/motion-cache.js','game.js'])w.eval(fs.readFileSync(path.join(ROOT,file),'utf8'));
 return {w,d,size,save:()=>JSON.parse(w.localStorage.getItem(KEY)),view:()=>d.getElementById('map').getAttribute('viewBox').split(' ').map(Number)};
}
function click(t,id){t.d.getElementById(id).click();}
function layer(t,value){const e=t.d.getElementById('map-layer');e.value=value;e.dispatchEvent(new t.w.Event('change'));}
function setup(t,id){click(t,'new-game-btn');t.d.querySelector('[data-scenario="'+id+'"]').click();click(t,'start-btn');}
function search(t,name,kind){const e=t.d.getElementById('map-search');e.value=name;e.dispatchEvent(new t.w.Event('input'));const b=[...t.d.querySelectorAll('#map-search-results button')].find(b=>b.querySelector('strong').textContent===name&&(!kind||b.querySelector('small').textContent.includes(kind)));assert(b,name);b.click();}
function minWidth(t,b){return Math.max(b[2],b[3]*t.size.width/t.size.height)*1.08;}
function covers(t,b){const v=t.view();assert(v[2]+1e-6>=minWidth(t,b));assert(b[0]>=v[0]-1e-6&&b[1]>=v[1]-1e-6&&b[0]+b[2]<=v[0]+v[2]+1e-6&&b[1]+b[3]<=v[1]+v[3]+1e-6);}
async function exportMap(t,name){const svg=t.d.getElementById('map').cloneNode(true);svg.setAttribute('xmlns','http://www.w3.org/2000/svg');svg.setAttribute('width',2160);svg.setAttribute('height',1350);for(const el of svg.querySelectorAll('image'))el.setAttribute('href','data:image/png;base64,'+fs.readFileSync(path.join(ROOT,el.getAttribute('href'))).toString('base64'));const xml=svg.outerHTML;fs.writeFileSync(path.join(OUT,name+'.svg'),xml);await sharp(Buffer.from(xml)).png().toFile(path.join(OUT,name+'.png'));}
(async()=>{
 const t=make();click(t,'start-btn');click(t,'asia-full');assert.equal(t.d.getElementById('map').dataset.lod,'overview');assert.equal(t.d.querySelectorAll('[data-country]').length,5);assert.equal(t.d.getElementById('territory-layer').getAttribute('visibility'),'hidden');assert.equal(t.d.getElementById('macro-layer').getAttribute('visibility'),'hidden');
 for(const name of ['曹魏','蜀汉','东吴'])assert(t.d.querySelector('[data-label-type="country"][data-label="'+name+'"]'));assert.equal(t.d.querySelectorAll('[data-label-type="city"][visibility="visible"],[data-label-type="region"][visibility="visible"],[data-label-type="unit"][visibility="visible"]').length,0);
 for(const el of t.d.querySelectorAll('[data-country]'))assert.equal(el.getAttribute('stroke'),'none');assert.equal(t.d.querySelectorAll('.country-border').length,5);assert.equal((t.d.querySelector('.country-border').getAttribute('d').match(/M/g)||[]).length,1);
 await exportMap(t,'three-countries');checks.push('三国最大概览只显示国家轮廓与国家名，隐藏内部州郡界');
 const baseline=t.save(),oldWei=t.d.querySelector('[data-country="wei"]').getAttribute('d'),oldWu=t.d.querySelector('[data-country="wu"]').getAttribute('d');
 const conquered={...baseline,provinces:baseline.provinces.map(p=>({...p}))};conquered.provinces.find(p=>p.owner==='wu').owner='wei';const changed=make(conquered);
 assert.notEqual(changed.d.querySelector('[data-country="wei"]').getAttribute('d'),oldWei);assert.notEqual(changed.d.querySelector('[data-country="wu"]').getAttribute('d'),oldWu);assert.equal(changed.save().provinces.length,120);checks.push('国家轮廓按地块实际控制权更新，不改变原地块');
 t.d.querySelector('[data-country="shu"]').dispatchEvent(new t.w.MouseEvent('click',{bubbles:true}));assert.equal(t.d.getElementById('map').dataset.lod,'region');assert.equal(t.d.querySelector('.territory-title').textContent,'蜀汉');
 t.d.querySelector('[data-country-region="益州"]').click();assert.equal(t.d.getElementById('map').dataset.lod,'district');assert.equal(t.d.querySelectorAll('[data-child]').length,15);checks.push('国家点击展开州省，再查看省内地块与情报');
 setup(t,'asia');assert.equal(t.d.getElementById('map').dataset.lod,'overview');assert.equal(t.d.getElementById('territory-layer').getAttribute('visibility'),'hidden');assert.equal(t.d.getElementById('macro-layer').getAttribute('visibility'),'hidden');for(const id of ['china','japan','uk','soviet'])assert(t.d.querySelector('[data-country="'+id+'"]'));
 await exportMap(t,'asia-countries');checks.push('二战最大概览按国家显示，中立国家保持独立');
 const atlas=t.w.SHANHE_ATLAS.scenarios.asia,z=atlas.regions.find(r=>r.id==='浙江省');search(t,'浙江省','概览区域');for(let i=0;i<20;i++)click(t,'zoom-in');covers(t,z.bounds);const floor=t.view();click(t,'zoom-in');assert.deepEqual(t.view(),floor);
 assert.equal(t.d.getElementById('map').dataset.lod,'district');assert.equal(t.d.querySelectorAll('[data-label-type="unit"][data-label="杭州"],[data-label-type="unit"][data-label="宁波"],[data-label-type="unit"][data-label="金华"],[data-label-type="unit"][data-label="温州"]').length,4);
 const h=atlas.units.find(p=>p.name==='杭州'),city=h.representativeCity;
 for(let i=0;i<12;i++){const b=t.view();t.d.getElementById('map').dispatchEvent(new t.w.WheelEvent('wheel',{deltaY:-200,clientX:(city.x-b[0])/b[2]*t.size.width,clientY:(city.y-b[1])/b[3]*t.size.height,bubbles:true}));}
 covers(t,z.bounds);checks.push('按钮和滚轮连续放大均停在完整浙江省范围，省内四块仍可见');
 search(t,'杭州','战略分区');covers(t,z.bounds);assert.equal(t.d.querySelector('.territory-title').textContent,'杭州');click(t,'focus-selected');covers(t,z.bounds);const army=t.save().provinces.find(p=>p.id===h.id).army;click(t,'recruit-btn');assert.equal(t.save().provinces.find(p=>p.id===h.id).army,army+6);covers(t,z.bounds);
 await exportMap(t,'zhejiang-zoom-limit');checks.push('搜索地块、选区定位及征兵均保留省级视野，详情照常使用');
 for(const name of ['四川省','江苏省','福建省']){search(t,name,'概览区域');const r=atlas.regions.find(r=>r.id===name);for(let i=0;i<12;i++)click(t,'zoom-in');covers(t,r.bounds);}
 checks.push('不同大小的省使用自己的边界限制最大放大');
 search(t,'杭州','战略分区');const old=t.save();old.camera={x:city.x-1,y:city.y-1,w:2,h:1.25};old.cameraAtHome=false;old.layer='city';old.gold.china=567;old.provinces.find(p=>p.id===h.id).army=222;
 const restored=make(old);covers(restored,z.bounds);assert.equal(restored.save().gold.china,567);assert.equal(restored.save().provinces.find(p=>p.id===h.id).army,222);assert.equal(restored.d.getElementById('map-layer').value,'district');checks.push('旧城市级视角恢复时收回到省级范围，保留资金与兵力');
 restored.size.width=2520;restored.size.height=1080;restored.w.dispatchEvent(new restored.w.Event('resize'));await new Promise(r=>setTimeout(r,120));restored.w.__mapTestClock.flush();covers(restored,z.bounds);checks.push('窗口变成超宽屏后仍完整显示一个省');
 setup(t,'three');search(t,'长安','历史城市');const three=t.w.SHANHE_ATLAS.scenarios.three,parent=three.regions.find(r=>r.bounds[0]<=1035.529&&r.bounds[0]+r.bounds[2]>=1035.529&&r.id==='关中郡域');assert(parent);covers(t,parent.bounds);for(let i=0;i<10;i++)click(t,'zoom-in');assert(t.view()[2]>30);checks.push('三国城市搜索和放大停在对应州级区域规模');
 assert.equal(errors.length,0,errors.join('\n'));const report={environment:'jsdom + actual SVG rendering; not browser UX acceptance',passed:checks,errors};fs.writeFileSync(path.join(OUT,'map-level-checks.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>windows.forEach(w=>w.close()));
