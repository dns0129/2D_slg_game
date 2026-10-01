/* Frame-by-frame camera/visibility checks. Uses jsdom, not browser UX acceptance.
   NODE_PATH=/private/tmp/shanhe-dom/node_modules node scripts/verify_zoom_motion.cjs */
const fs=require('fs'),path=require('path'),assert=require('assert'),{JSDOM}=require('jsdom');
const {installDomClock}=require('./dom_clock.cjs');
const ROOT=path.resolve(__dirname,'..'),KEY='shanhe-strategy-save-v3',checks=[],errors=[],windows=[];
function make(saved){
 const w=new JSDOM(fs.readFileSync(path.join(ROOT,'index.html'),'utf8'),{url:'http://127.0.0.1:8765/',runScripts:'outside-only',pretendToBeVisual:true}).window,d=w.document;windows.push(w);
 const clock=installDomClock(w);w.addEventListener('error',e=>errors.push(e.error?.stack||e.message));
 d.getElementById('map').getBoundingClientRect=()=>({width:1440,height:900,left:0,top:0});
 if(saved)w.localStorage.setItem(KEY,JSON.stringify(saved));for(const file of ['vendor/polygon-clipping.umd.min.js','maps/atlas.js','maps/motion-cache.js','game.js'])w.eval(fs.readFileSync(path.join(ROOT,file),'utf8'));
 return {w,d,clock,view:()=>d.getElementById('map').getAttribute('viewBox').split(' ').map(Number),save:()=>JSON.parse(w.localStorage.getItem(KEY))};
}
const click=(t,id)=>t.d.getElementById(id).click();
function layer(t,value){const el=t.d.getElementById('map-layer');el.value=value;el.dispatchEvent(new t.w.Event('change'));}
function search(t,name,kind){const el=t.d.getElementById('map-search');el.value=name;el.dispatchEvent(new t.w.Event('input'));const b=[...t.d.querySelectorAll('#map-search-results button')].find(b=>b.querySelector('strong').textContent===name&&(!kind||b.querySelector('small').textContent.includes(kind)));assert(b,name);b.click();}
function opacity(t,id){return +t.d.getElementById(id).getAttribute('opacity');}
function covers(t,b){const [x,y,w,h]=t.view();assert(w>=Math.max(b[2],b[3]*1.6)*1.08-1e-6);assert(x<=b[0]&&y<=b[1]&&x+w>=b[0]+b[2]&&y+h>=b[1]+b[3]);}
try{
 const t=make();t.d.querySelector('[data-scenario="asia"]').click();click(t,'start-btn');t.clock.flush();
 const home=t.view(),pathNode=t.d.querySelector('[data-unit]'),beforeArmy=t.save().provinces.map(p=>p.army);
 assert.equal(opacity(t,'national-layer'),1);assert.equal(opacity(t,'macro-layer'),0);assert.equal(opacity(t,'district-border-layer'),0);
 click(t,'zoom-in');assert.deepEqual(t.view(),home);const target=t.save().camera;
 t.clock.step(16);const first=t.view();assert(first[2]<home[2]&&first[2]>target.w);
 t.clock.step(64);const middle=t.view();assert(middle[2]<first[2]&&middle[2]>target.w);
 assert.equal(t.d.querySelector('[data-unit]'),pathNode);t.clock.flush();assert(Math.abs(t.view()[2]-target.w)<1e-7);
 checks.push('缩放有连续中间帧，地理路径保持原节点，最终准确停靠');
 for(let i=0;i<3;i++)click(t,'zoom-in');t.clock.step(48);const moving=t.view();
 click(t,'zoom-in');assert.deepEqual(t.view(),moving);click(t,'zoom-out');assert.deepEqual(t.view(),moving);t.clock.flush();
 assert(Math.abs(t.view()[2]-t.save().camera.w)<1e-7);checks.push('连续输入与反向输入从当前画面接续，没有镜头跳变');
 click(t,'zoom-reset');t.clock.flush();const anchorBefore=t.view(),px=.55,py=.5;
 t.d.getElementById('map').dispatchEvent(new t.w.WheelEvent('wheel',{deltaY:-45,clientX:px*1440,clientY:py*900,bubbles:true}));
 t.clock.step(80);const anchorDuring=t.view();assert(Math.abs(anchorBefore[0]+anchorBefore[2]*px-anchorDuring[0]-anchorDuring[2]*px)<1e-6);assert(Math.abs(anchorBefore[1]+anchorBefore[3]*py-anchorDuring[1]-anchorDuring[3]*py)<1e-6);t.clock.flush();
 checks.push('滚轮按输入幅度平滑缩放，动画中保留鼠标地理锚点');
 layer(t,'overview');t.clock.flush();const countryLabel=t.d.querySelector('[data-label-type="country"][visibility="visible"]');assert(countryLabel);
 layer(t,'region');t.clock.step(40);const national=opacity(t,'national-layer'),region=opacity(t,'macro-layer');assert(national>0&&national<1&&region>0&&region<1);
 assert(+countryLabel.getAttribute('opacity')>0&&+countryLabel.getAttribute('opacity')<1);t.clock.flush();assert.equal(opacity(t,'national-layer'),0);assert.equal(opacity(t,'macro-layer'),1);
 layer(t,'district');t.clock.step(40);assert(opacity(t,'district-border-layer')>0&&opacity(t,'district-border-layer')<1);t.clock.flush();assert.equal(opacity(t,'district-border-layer'),1);
 assert(t.d.querySelector('[data-label-type="unit"][visibility="visible"] [data-map-detail][opacity="1"]'));
 layer(t,'overview');t.clock.step(40);assert(opacity(t,'district-border-layer')>0&&opacity(t,'district-border-layer')<1);t.clock.flush();assert.equal(opacity(t,'district-border-layer'),0);
 checks.push('国家名、州省名、地块名、细分边界及兵力信息均渐显渐隐');
 search(t,'浙江省','概览区域');t.clock.flush();const z=t.w.SHANHE_ATLAS.scenarios.asia.regions.find(r=>r.id==='浙江省');
 for(let i=0;i<30;i++)click(t,'zoom-in');t.clock.flush();covers(t,z.bounds);const floor=t.view();click(t,'zoom-in');t.clock.flush();assert.deepEqual(t.view(),floor);
 search(t,'杭州','战略分区');t.clock.flush();covers(t,z.bounds);checks.push('动画结束仍遵守完整省级范围，搜索地块也不越过上限');
 assert.equal(t.d.querySelectorAll('#map [stroke-dasharray]').length,0);
 const css=fs.readFileSync(path.join(ROOT,'styles.css'),'utf8');assert(css.includes('.country-shape:hover{fill-opacity:.5;stroke:none}'));
 assert([...t.d.querySelectorAll('[data-country]')].every(el=>!el.classList.contains('province-shape')&&el.getAttribute('stroke')==='none'));
 assert([...t.d.querySelectorAll('[data-unit-border]')].every(el=>!el.hasAttribute('stroke-dasharray')));checks.push('国家悬停只高亮填色与外缘，所有地图边界均无虚线');
 click(t,'zoom-out');t.clock.step(80);const interrupted=t.view(),map=t.d.getElementById('map');
 const down=new t.w.MouseEvent('pointerdown',{clientX:400,clientY:400,button:0,bubbles:true});Object.defineProperty(down,'pointerId',{value:1});map.dispatchEvent(down);t.clock.flush();assert.deepEqual(t.view(),interrupted);
 checks.push('拖拽开始时停止缩放动画，后续帧不会把镜头拉回');
 assert.deepEqual(t.save().provinces.map(p=>p.army),beforeArmy);const restored=make(t.save());restored.clock.flush();assert.equal(restored.save().gold.china,t.save().gold.china);checks.push('动画与显示变化保留地块兵力、资金和存档');
 const up=new t.w.MouseEvent('pointerup',{clientX:400,clientY:400,button:0,bubbles:true});Object.defineProperty(up,'pointerId',{value:1});map.dispatchEvent(up);
 search(t,'杭州','战略分区');t.clock.flush();const h=t.w.SHANHE_ATLAS.scenarios.asia.units.find(p=>p.name==='杭州');const oldArmy=t.save().provinces.find(p=>p.id===h.id).army;
 click(t,'recruit-btn');t.clock.flush();assert(t.d.querySelector('[data-unit="'+h.id+'"] title').textContent.includes('驻军 '+(oldArmy+6)));assert.equal(t.d.querySelector('[data-label-type="unit"][data-label="杭州"] [data-map-detail]').textContent,String(oldArmy+6));
 assert.equal(errors.length,0,errors.join('\n'));const report={environment:'deterministic requestAnimationFrame + jsdom; not real browser UX acceptance',passed:checks,errors};
 fs.writeFileSync(path.join(ROOT,'previews/historical-atlas-v3/output/zoom-motion-checks.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(e){console.error(e.stack);process.exitCode=1;}finally{windows.forEach(w=>w.close());}
