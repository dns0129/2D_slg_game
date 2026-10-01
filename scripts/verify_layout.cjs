/* Focused checks for full-map floating HUD, minimap, war state and city labels.
   NODE_PATH=/private/tmp/shanhe-dom/node_modules node scripts/verify_layout.cjs
   DOM behavior checks only; this is not browser layout acceptance. */
const fs=require('fs'),path=require('path'),assert=require('assert'),{JSDOM}=require('jsdom');
const ROOT=path.resolve(__dirname,'..'),KEY='shanhe-strategy-save-v3',checks=[],errors=[];
const {installDomClock}=require('./dom_clock.cjs');
function make(snapshot){
 const dom=new JSDOM(fs.readFileSync(path.join(ROOT,'index.html'),'utf8'),{url:'http://127.0.0.1:8765/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,d=w.document;installDomClock(w,{autoFlush:true});w.addEventListener('error',e=>errors.push(e.error?.stack||e.message));
 d.getElementById('map').getBoundingClientRect=()=>({width:1440,height:900,left:0,top:0});
 d.getElementById('mini-map').getBoundingClientRect=()=>({width:220,height:129,left:29,top:723});
 if(snapshot)w.localStorage.setItem(KEY,JSON.stringify(snapshot));
 w.eval(fs.readFileSync(path.join(ROOT,'vendor/polygon-clipping.umd.min.js'),'utf8'));w.eval(fs.readFileSync(path.join(ROOT,'maps/atlas.js'),'utf8'));w.eval(fs.readFileSync(path.join(ROOT,'maps/motion-cache.js'),'utf8'));w.eval(fs.readFileSync(path.join(ROOT,'game.js'),'utf8'));
 return {w,d,dom,save:()=>JSON.parse(w.localStorage.getItem(KEY))};
}
function click(t,id){const e=t.d.getElementById(id);assert(e,id);e.click();}
function setup(t,scenario,player){click(t,'new-game-btn');t.d.querySelector('[data-scenario="'+scenario+'"]').click();t.d.querySelector('[data-faction="'+player+'"]').click();click(t,'start-btn');}
function search(t,name,kind){const e=t.d.getElementById('map-search');e.value=name;e.dispatchEvent(new t.w.Event('input'));const b=[...t.d.querySelectorAll('#map-search-results button')].find(b=>b.querySelector('strong').textContent===name&&(!kind||b.querySelector('small').textContent.includes(kind)));assert(b,'Missing search '+name);b.click();}
function pointer(t,type,x,y){const e=new t.w.MouseEvent(type,{clientX:x,clientY:y,bubbles:true,button:0});Object.defineProperty(e,'pointerId',{value:7});return e;}
(async()=>{
 const t=make();click(t,'start-btn');const css=fs.readFileSync(path.join(ROOT,'styles.css'),'utf8');
 assert(css.includes('.full-map-game,.map-area,.map-wrap{position:absolute;inset:0}'));
 assert.equal(t.d.getElementById('map').parentElement.id,'map-wrap');assert(!t.d.querySelector('.workspace'));
 assert.equal(t.d.getElementById('war-overview').textContent,'蜀汉东吴');assert.equal(t.d.getElementById('turn-label').textContent,'222年 12月');
 assert(t.d.getElementById('mini-view'));assert(t.d.getElementById('inspector-panel').classList.contains('hidden'));checks.push('地图全窗口结构、三国交战概览、当前年月、小地图初始化');
 setup(t,'asia','china');const atlas=t.w.SHANHE_ATLAS.scenarios.asia;
 assert.equal(t.d.getElementById('war-overview').textContent,'日本满洲国');assert.equal(t.d.getElementById('map-mode').value,'control');
 const countries=t.d.querySelectorAll('[data-country]');assert(countries.length>0);assert([...countries].every(p=>+p.getAttribute('fill-opacity')===.38));assert(t.d.querySelectorAll('#context-layer path').length>10);
 assert([...t.d.querySelectorAll('#context-layer path')].every(p=>p.getAttribute('fill')!=='#ffffff'));checks.push('默认淡色国家填充，包括中立及西亚背景国家');
 const chinese=atlas.units.filter(p=>p.id.startsWith('cn-'));assert.equal(chinese.length,125);assert(chinese.every(p=>p.representativeCity&&!/分区|[一二三四]区|·\d/.test(p.name)));
 assert.deepEqual(atlas.units.filter(p=>p.parent==='江苏省').map(p=>p.name).sort(),['南京','徐州','苏州','盐城'].sort());assert.deepEqual(atlas.units.filter(p=>p.parent==='浙江省').map(p=>p.name).sort(),['杭州','宁波','金华','温州'].sort());
 assert(chinese.some(p=>p.name==='北平'));assert(chinese.some(p=>p.name==='迪化'));checks.push('125 个地块以城市或聚落命名；江苏、浙江及年代名称');
 search(t,'浙江省');assert(!t.d.getElementById('inspector-panel').classList.contains('hidden'));assert.equal(t.d.querySelectorAll('[data-child]').length,4);
 search(t,'杭州','战略分区');assert.equal(t.d.querySelector('.territory-title').textContent,'杭州');assert(t.d.getElementById('inspector-content').textContent.includes('代表地名：杭州'));
 const box=t.d.getElementById('map').getAttribute('viewBox');click(t,'close-inspector');assert(t.d.getElementById('inspector-panel').classList.contains('hidden'));assert.equal(t.d.getElementById('map').getAttribute('viewBox'),box);checks.push('地块/省概览悬浮检视、关闭后视野不变');
 click(t,'toggle-overview');assert(t.d.getElementById('overview-body').classList.contains('hidden'));assert.equal(t.d.getElementById('toggle-overview').getAttribute('aria-expanded'),'false');click(t,'toggle-overview');assert(!t.d.getElementById('overview-body').classList.contains('hidden'));checks.push('左上概览可收起与恢复');
 const mini=t.d.getElementById('mini-map');mini.dispatchEvent(pointer(t,'pointerdown',190,780));mini.dispatchEvent(pointer(t,'pointerup',190,780));await new Promise(r=>setTimeout(r,30));
 assert.notEqual(t.d.getElementById('map').getAttribute('viewBox'),box);const [x,y,w,h]=t.d.getElementById('map').getAttribute('viewBox').split(' ').map(Number),rect=t.d.getElementById('mini-view');assert.equal(+rect.getAttribute('x'),x);assert.equal(+rect.getAttribute('width'),w);assert(Math.abs(w/h-1.6)<.00001);checks.push('小地图点击定位、视野框同步、保持地图纵横比例');
 const ukBefore=t.save().provinces.filter(p=>p.owner==='uk');click(t,'end-turn-btn');assert.equal(t.d.getElementById('turn-label').textContent,'1942年 1月');assert.equal(t.d.getElementById('round-counter').textContent,'第 2 回合');assert.deepEqual(t.save().provinces.filter(p=>ukBefore.some(q=>q.id===p.id)).map(p=>p.owner),ukBefore.map(p=>p.owner));checks.push('月度时间跨年；AI 不向未交战国家自动进攻');
 setup(t,'asia','uk');const s=t.save(),by=new Map(s.provinces.map(p=>[p.id,p]));const a=s.provinces.find(p=>p.owner==='uk'&&atlas.adjacency[p.id].some(id=>by.get(id).owner!=='uk'&&by.get(id).owner!=='neutral'));assert(a,'British/other country adjacent pair');a.army=1000;
 const b=atlas.adjacency[a.id].map(id=>by.get(id)).find(p=>p.owner!=='uk'&&p.owner!=='neutral');b.army=1000;const enemyName={china:'中华民国',japan:'日本',france:'法国',thailand:'泰国',soviet:'苏联',dutch:'荷属东印度',us:'美国',manchu:'满洲国'}[b.owner];
 const war=make(s),base=atlas.units.find(p=>p.id===a.id);assert.equal(war.d.getElementById('war-count').textContent,'无交战势力');search(war,base.name,base.kind);war.d.querySelector('[data-neighbor="'+b.id+'"]').click();assert(war.d.getElementById('move-btn').textContent.includes('宣战并进攻'));click(war,'move-btn');assert(war.save().wars.includes([b.owner,'uk'].sort().join('|')));assert(war.d.getElementById('war-overview').textContent.includes(enemyName));
 const restored=make(war.save());assert(restored.d.getElementById('war-overview').textContent.includes(enemyName));assert.equal(restored.save().gold.uk,war.save().gold.uk);checks.push('进攻按钮明确宣战，交战名单实时更新并随存档恢复');
 const legacy={...s};delete legacy.wars;const old=make(legacy);assert.equal(old.d.getElementById('war-count').textContent,'无交战势力');assert.equal(old.save().gold.uk,s.gold.uk);assert.equal(old.save().provinces.find(p=>p.id===a.id).army,1000);checks.push('已有 v3 存档补充交战状态，保留国库与兵力');
 assert.equal(errors.length,0,errors.join('\n'));const output={environment:'jsdom behavior + geometry label checks; browser visual acceptance unavailable',passed:checks,errors};fs.writeFileSync(path.join(ROOT,'previews/historical-atlas-v3/output/layout-checks.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));[t,war,restored,old].forEach(x=>x.w.close());
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
