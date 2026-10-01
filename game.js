(() => {
  'use strict';

  const SVG = 'http://www.w3.org/2000/svg';
  const SAVE_KEY = 'shanhe-strategy-save-v3';
  const $ = id => document.getElementById(id);
  
  const atlas = window.SHANHE_ATLAS;
  if (!atlas || atlas.version !== 3) throw new Error('历史地图资源未加载，请重新打开 index.html。');
  const colors = {
    wei:{name:'曹魏',short:'魏',color:'#adc1c8',dark:'#5b7d8b',gold:110,motto:'洛阳为都，据中原'},
    shu:{name:'蜀汉',short:'蜀',color:'#bac7ad',dark:'#738d60',gold:90,motto:'成都为都，据益州'},
    wu:{name:'东吴',short:'吴',color:'#b6cfcb',dark:'#5c9289',gold:95,motto:'吴王孙权，立足江东'},
    liaodong:{name:'辽东公孙氏',short:'辽',color:'#cec4ae',dark:'#9b8860',gold:55,motto:'公孙恭治辽东'},
    shi:{name:'交州士氏',short:'士',color:'#c5bbcf',dark:'#94819e',gold:45,motto:'士燮领交趾，臣服孙权'},
    china:{name:'中华民国',short:'中',color:'#b8ccb3',dark:'#739567',gold:100,motto:'重庆为陪都，持续抗战'},
    japan:{name:'日本',short:'日',color:'#d4b9b0',dark:'#a57569',gold:125,motto:'东京府 · 府县及殖民辖区'},
    manchu:{name:'满洲国',short:'满',color:'#d7d0b5',dark:'#a39362',gold:55,motto:'日本扶植的政权 · 新京'},
    uk:{name:'英国',short:'英',color:'#c2c2d5',dark:'#8385a5',gold:105,motto:'英属印度、缅甸与马来亚'},
    us:{name:'美国',short:'美',color:'#b5cbd5',dark:'#6e95a6',gold:95,motto:'菲律宾自由邦，太平洋战前'},
    soviet:{name:'苏联',short:'苏',color:'#cbbcb8',dark:'#997d78',gold:105,motto:'亚洲领土与远东战线'},
    thailand:{name:'泰国',short:'泰',color:'#ced1b0',dark:'#929a64',gold:65,motto:'法泰条约后的领土'},
    dutch:{name:'荷属东印度',short:'荷',color:'#d2c6b1',dark:'#a18b67',gold:85,motto:'1941 年驻扎区体系'},
    france:{name:'法国',short:'法',color:'#bcc6d7',dark:'#7a90ad',gold:80,motto:'印度支那殖民行政与日军驻扎并存'}
  };
  const definitions = {
    three:{name:'三国鼎立',era:'公元 222 年',subtitle:'州郡复原 · 夷陵战后',description:'魏、蜀汉与吴王孙权分据山河。州郡使用历史底本复原；联合郡域及不确定界线可在情报中查阅。',caption:'三国 · 州郡图',year:222,initialWars:[['wei','shu'],['wei','wu']],factionIds:['wei','shu','wu','liaodong','shi']},
    asia:{name:'二战亚洲',era:'1941 年 12 月 6 日',subtitle:'太平洋战争前夕 · 亚洲全图',description:'起始于太平洋战争前夕。行政区划与军事控制分开显示：香港、菲律宾、荷属东印度尚未被日本占领。',caption:'亚洲 · 1941 年行政底本',year:1941,initialWars:[['china','japan'],['china','manchu']],factionIds:['china','japan','manchu','uk','us','soviet','thailand','dutch','france']}
  };
  // A new scenario supplies its own dated geometry and hierarchy, while sharing
  // the physical atlas. Nothing is renamed from a modern province at runtime.
  function boundsOf(units){
    const x=Math.min(...units.map(p=>p.bounds[0])),y=Math.min(...units.map(p=>p.bounds[1]));
    return [x,y,Math.max(...units.map(p=>p.bounds[0]+p.bounds[2]))-x,Math.max(...units.map(p=>p.bounds[1]+p.bounds[3]))-y];
  }
  const scenarios = Object.fromEntries(Object.entries(atlas.scenarios).map(([id,map]) => {
    const meta=definitions[id] || map.meta;
    if (!meta) throw new Error(`剧本 ${id} 缺少元数据`);
    return [id,{...meta,...map,campaignBounds:boundsOf(map.units),coreBounds:id==='three'?boundsOf(map.units.filter(p=>['wei','shu','wu'].includes(p.owner))):map.homeBounds,factions:Object.fromEntries((meta.factionIds||Object.keys(meta.factions||{})).filter(fid=>map.units.some(p=>p.owner===fid)).map(fid=>[fid,(meta.factions||colors)[fid]])),provinces:map.units}];
  }));

  const terrainName = { plain:'平原',hill:'丘陵',mountain:'山地',jungle:'丛林' };
  const state = {game:null,setupScenario:'three',setupFaction:'wei',selected:null,source:null,target:null,macroSelected:null,countrySelected:null,zoomArea:null,troops:1,view:{x:0,y:0,w:1200,h:760},homeView:false,layer:'auto',mode:'control',sceneKey:null,miniKey:null,lod:null,drag:null,suppressClick:false,toastTimer:null};
  Object.assign(state,{cameraMotion:null,frameRequest:null,lastFrame:0,presentation:null,territoryKey:null,labelNodes:new Map(),miniOwners:null,mapRect:null,labelLayoutAt:-Infinity,labelLayoutKey:null,wheelInput:null,panInput:null,miniDragging:false});
  const motionCache=window.SHANHE_MOTION_CACHE?new window.SHANHE_MOTION_CACHE($('map'),atlas.physical):null;
  function setAttr(el,key,value){value=String(value);if(el.getAttribute(key)!==value)el.setAttribute(key,value);}
  function setText(el,value){if(el.textContent!==value)el.textContent=value;}

  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function svg(tag, attrs={}, parent) { const e=document.createElementNS(SVG,tag); Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,String(v))); if(parent) parent.appendChild(e); return e; }
  function getScenario(){return scenarios[state.game.scenario];}
  let provinceList=null,provinceIndex=new Map();
  function province(id){if(provinceList!==state.game.provinces){provinceList=state.game.provinces;provinceIndex=new Map(provinceList.map(p=>[p.id,p]));}return provinceIndex.get(id);}
  function faction(id){return getScenario().factions[id];}
  function owns(id){return state.game.provinces.filter(p=>p.owner===id);}
  function income(id){return owns(id).reduce((sum,p)=>sum+p.tax+p.level,0);}
  function army(id){return owns(id).reduce((sum,p)=>sum+p.army,0);}
  const ringCache=new Map(),geometryCache=new Map(),countryCache=new Map();
  function ringsOf(path){
    if(!ringCache.has(path))ringCache.set(path,Array.from(path.matchAll(/M([^Z]+)Z/g),m=>m[1].split('L').map(pair=>pair.split(',').map(Number))));
    return ringCache.get(path);
  }
  function insideRing(x,y,ring){
    let inside=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    }
    return inside;
  }
  function insidePath(x,y,path){return ringsOf(path).reduce((inside,ring)=>inside!==insideRing(x,y,ring),false);}
  function unitGeometry(p){
    const key=state.game.scenario+'/'+p.id;
    if(!geometryCache.has(key)){
      const rings=ringsOf(p.path);geometryCache.set(key,rings.length===1?[[rings[0]]]:window.polygonClipping.xor(...rings.map(r=>[r])));
    }
    return geometryCache.get(key);
  }
  function geometryPath(geometry){return geometry.map(p=>p.map(r=>'M'+r.map(([x,y])=>`${x.toFixed(3)},${y.toFixed(3)}`).join('L')+'Z').join('')).join('');}
  function interiorPoint(geometry){
    const area=ring=>Math.abs(ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];},0)/2);
    const polygon=geometry.reduce((a,b)=>area(a[0])>area(b[0])?a:b),outer=polygon[0];
    const lo=Math.min(...outer.map(p=>p[1])),hi=Math.max(...outer.map(p=>p[1]));let best=null;
    for(const f of [.5,.4,.6,.3,.7]){
      const y=lo+(hi-lo)*f,xs=[];
      for(const ring of polygon)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
        const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y))xs.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));
      }
      xs.sort((a,b)=>a-b);for(let i=0;i+1<xs.length;i+=2)if(!best||xs[i+1]-xs[i]>best.width)best={x:(xs[i]+xs[i+1])/2,y,width:xs[i+1]-xs[i]};
    }
    return best||{x:outer[0][0],y:outer[0][1]};
  }
  function countries(){
    const groups=new Map(),anchors={wei:'洛阳',shu:'成都',wu:'武昌',shi:'龙编',china:'重庆',japan:'东京',manchu:'新京',us:'马尼拉',thailand:'曼谷',dutch:'巴达维亚',france:'河内'};
    for(const p of state.game.provinces){const id=p.owner==='neutral'?'neutral:'+p.parent:p.owner;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(p);}
    return [...groups].map(([id,ps])=>{
      const key=state.game.scenario+'/'+id,signature=ps.map(p=>p.id).join('|');let shape=countryCache.get(key);
      if(shape?.signature!==signature){
        const geometry=window.polygonClipping.union(...ps.map(unitGeometry)),path=geometryPath(geometry),anchor=getScenario().cities.find(c=>c.name===anchors[id]);
        // Neighbouring simplified rings leave hairline gaps. Outline outer rings
        // only; an enclave is outlined by the country occupying it.
        shape={signature,path,outlinePath:geometryPath(geometry.map(p=>[p[0]])),bounds:boundsOf(ps),...(anchor&&insidePath(anchor.x,anchor.y,path)?{x:anchor.x,y:anchor.y}:interiorPoint(geometry))};countryCache.set(key,shape);
      }
      const f=faction(id)||{name:ps[0].parent,color:neutralColor(ps[0].parent),dark:'#81949e'};
      return {id,...shape,name:f.name,color:f.color,dark:f.dark,children:ps.map(p=>p.id)};
    });
  }
  function selectCountry(id){
    const c=countries().find(c=>c.id===id);if(!c)return;
    state.countrySelected=id;state.selected=state.source=state.target=state.macroSelected=null;state.zoomArea=null;
    state.layer='region';animateView(viewDestination(()=>{fitBounds(c.bounds,1.08);enforceProvinceZoom(areaAtPoint(c.x,c.y));clampView();}));save();render();
  }
  function renderCountryInspector(){
    const c=countries().find(c=>c.id===state.countrySelected);if(!c){state.countrySelected=null;renderInspector();return;}
    const ps=c.children.map(province),parents=[...new Set(ps.map(p=>p.parent))];
    $('inspector-content').innerHTML=`<div class="territory-breadcrumb">国家概览</div><h2 class="territory-title">${esc(c.name)}</h2><div class="territory-metrics"><div class="metric"><span>控制地块</span><strong>${ps.length}</strong></div><div class="metric"><span>总兵力</span><strong>${ps.reduce((n,p)=>n+p.army,0)}</strong></div></div><div class="inspector-divider"></div><div class="action-title">查看州省与辖区</div><div class="macro-children">${parents.map(name=>`<button data-country-region="${esc(name)}">${esc(name)}<small>${ps.filter(p=>p.parent===name).length} 地块</small></button>`).join('')}</div>`;
    $('inspector-content').querySelectorAll('[data-country-region]').forEach(b=>b.onclick=()=>selectMacro(b.dataset.countryRegion));
  }
  function areaForUnit(p,point){
    const s=getScenario(),r=p&&s.regions.find(r=>r.id===p.parent);
    if(p&&(state.game.scenario==='three'||p.id.startsWith('cn-')||p.id.startsWith('burma-'))&&r)return {key:'region:'+r.id,name:r.name,bounds:r.bounds};
    if(p&&(/^(japan-|korea-|taiwan-|malaya-|india-state-|philippines-|indo-)/.test(p.id)||['省','道','州','厅','县'].includes(p.kind)))return {key:'unit:'+p.id,name:p.name,bounds:p.bounds};
    if(r&&r.children.length>1)return {key:'region:'+r.id,name:r.name,bounds:r.bounds};
    const reference=s.regions.find(r=>r.id===(state.game.scenario==='three'?'兖州':'浙江省'))||s.regions[0];
    if(!p&&!point)return {key:'region:'+reference.id,name:reference.name,bounds:reference.bounds};
    const x=point?.x??p.x,y=point?.y??p.y,b=reference.bounds;
    return {key:'approx:'+(p?.id||'context'),name:'省级视野',bounds:[x-b[2]/2,y-b[3]/2,b[2],b[3]]};
  }
  function areaAtPoint(x,y){
    const p=state.game.provinces.find(p=>x>=p.bounds[0]&&x<=p.bounds[0]+p.bounds[2]&&y>=p.bounds[1]&&y<=p.bounds[1]+p.bounds[3]&&insidePath(x,y,p.path));
    return p?areaForUnit(p,{x,y}):state.zoomArea||areaForUnit(null,{x,y});
  }
  function enforceProvinceZoom(area=state.zoomArea){
    const v=state.view;area ||= areaAtPoint(v.x+v.w/2,v.y+v.h/2);
    const b=area.bounds,minWidth=Math.max(b[2],b[3]*mapSize().width/mapSize().height)*1.08;
    if(v.w<minWidth-1e-6){state.zoomArea=area;fitBounds(b,1.08);return true;}
    return false;
  }
  function warKey(a,b){return [a,b].sort().join('|');}
  function isAtWar(a,b){return a!==b && (b==='neutral'||state.game.wars.includes(warKey(a,b)));}
  function campaignDate(){const [year,month]=getScenario().date.split('-').map(Number),months=year*12+month-1+state.game.turn-1;return `${Math.floor(months/12)}年 ${months%12+1}月`;}
  function log(message){state.game.log.unshift({turn:state.game.turn,message});state.game.log=state.game.log.slice(0,20);}
  function save(){
    if(!state.game)return;
    const snapshot={...state.game,provinces:state.game.provinces.map(({id,owner,army,tax,level})=>({id,owner,army,tax,level})),camera:{...(state.cameraMotion?.to||state.view)},cameraVersion:1,cameraAtHome:state.homeView,zoomAreaKey:state.zoomArea?.key||null,layer:state.layer,mode:state.mode};
    try{localStorage.setItem(SAVE_KEY,JSON.stringify(snapshot));}catch(err){toast('本机存储已满，当前战役尚未保存');console.warn('存档写入失败',err);}
  }
  function toast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>el.classList.remove('show'),2900);}

  function isSeaLink(a,b){return getScenario().seaRoutes.some(pair=>pair.includes(a)&&pair.includes(b));}
  function neighbors(a,b){return Boolean(a && b && getScenario().adjacency[a.id]?.includes(b.id));}
  function adjacents(p){const ids=new Set(getScenario().adjacency[p.id]||[]);return state.game.provinces.filter(q=>ids.has(q.id));}

  function renderSetup(){
    $('scenario-options').innerHTML=Object.entries(scenarios).map(([id,s])=>`<button class="scenario-option ${id===state.setupScenario?'selected':''}" data-scenario="${id}"><span class="check">${id===state.setupScenario?'✓':''}</span><span class="era">${esc(s.era)} · SCENARIO</span><strong>${esc(s.name)}</strong><small>${esc(s.subtitle)}</small></button>`).join('');
    $('faction-options').innerHTML=Object.entries(scenarios[state.setupScenario].factions).map(([id,f])=>`<button class="faction-option ${id===state.setupFaction?'selected':''}" data-faction="${id}"><i style="background:${f.dark}"></i>${esc(f.name)}</button>`).join('');
    $('scenario-options').querySelectorAll('button').forEach(btn=>btn.onclick=()=>{state.setupScenario=btn.dataset.scenario;state.setupFaction=Object.keys(scenarios[state.setupScenario].factions)[0];renderSetup();});
    $('faction-options').querySelectorAll('button').forEach(btn=>btn.onclick=()=>{state.setupFaction=btn.dataset.faction;renderSetup();});
  }
  function startGame(){
    stopCameraMotion();
    const s=scenarios[state.setupScenario];
    state.game={mapVersion:s.mapVersion,scenario:state.setupScenario,player:state.setupFaction,turn:1,wars:(s.initialWars||[]).map(pair=>warKey(...pair)),gold:Object.fromEntries(Object.entries(s.factions).map(([id,f])=>[id,f.gold])),provinces:s.provinces.map(p=>({...p})),log:[],ended:false};
    state.selected=state.source=state.target=state.macroSelected=state.countrySelected=null;state.zoomArea=null;state.layer='auto';state.mode='control';state.sceneKey=state.miniKey=null;resetView();
    $('map-search').value='';$('map-search-results').replaceChildren();$('map-search-results').classList.add('hidden');
    log(`${s.factions[state.game.player].name}的征程开始了。`);save();$('setup-overlay').classList.add('hidden');$('resume-btn').classList.remove('hidden');render();toast('点击己方领土，开始下达命令');
  }

  function render(){
    if(!state.game)return;
    const s=getScenario(), p=state.game.player, f=s.factions[p], count=owns(p).length;
    $('scenario-name').textContent=s.name;
    $('turn-label').textContent=campaignDate();$('round-counter').textContent=`第 ${state.game.turn} 回合`;
    $('time-note').textContent=`每回合一个月 · 底图 ${s.year} 年`;
    $('campaign-title').textContent=s.name;
    $('campaign-description').textContent=s.description;
    $('player-card').classList.remove('empty');$('player-card').innerHTML=`<span class="player-emblem" style="background:${f.dark}">${esc(f.short)}</span><div><strong>${esc(f.name)}</strong><small>${esc(f.motto)}</small></div>`;
    $('gold-stat').textContent=state.game.gold[p]||0;$('income-stat').textContent=`+${income(p)}`;$('province-stat').textContent=count;$('army-stat').textContent=army(p);
    const enemies=Object.keys(s.factions).filter(id=>id!==p&&isAtWar(p,id)&&owns(id).length);
    $('war-count').textContent=enemies.length?`${enemies.length} 个交战势力`:'无交战势力';
    $('war-overview').innerHTML=enemies.length?enemies.map(id=>`<span class="war-chip"><i style="background:${s.factions[id].dark}"></i>${esc(s.factions[id].name)}</span>`).join(''):'<span class="peace-status">当前战区暂无交战</span>';
    $('faction-count').textContent=`${Object.keys(s.factions).length} 个势力`;
    $('faction-list').innerHTML=Object.entries(s.factions).map(([id,item])=>`<div class="faction-row ${id===p?'is-player':''}"><span class="faction-emblem" style="background:${item.dark}">${esc(item.short)}</span><span class="name">${esc(item.name)}${id===p?' · 你':''}</span><span class="territory-count">${owns(id).length} 领土</span></div>`).join('');
    $('event-log').innerHTML=state.game.log.map(item=>`<div class="log-item"><span class="turn-tag">回合 ${item.turn}</span>${esc(item.message)}</div>`).join('');
    $('map-caption').textContent=s.caption;
    $('map-subcaption').textContent=state.source?'请选择相邻领土作为目标':'点击领土查看详情';
    $('map-hint').textContent=state.source?`出发地：${province(state.source)?.name||''}`:'滚轮缩放 · 拖动地图浏览';
    $('end-turn-btn').disabled=state.game.ended;
    renderMap();renderInspector();
  }

  const physical=atlas.physical;
  const contextPalette=['#d6c3b1','#c4d6bc','#c2d0df','#d8c2cc','#d3cfb1','#bed5d1','#d0c6dc','#c6d3db'];
  function contextColor(index){return contextPalette[index%contextPalette.length];}
  function neutralColor(name){return contextColor(Array.from(name).reduce((n,c)=>n+c.charCodeAt(0),0));}
  function miniBounds(){return state.game.scenario==='three'?getScenario().campaignBounds:physical.fullBounds;}
  function renderMinimap(frameOnly=false){
    const map=$('mini-map'),b=miniBounds();
    if(state.miniKey!==state.game.scenario){
      map.replaceChildren();map.setAttribute('viewBox',b.join(' '));
      svg('path',{d:physical.land,fill:'#f9fbf7',stroke:'#c5d3d5','stroke-width':.5,'vector-effect':'non-scaling-stroke','fill-rule':'evenodd'},map);
      if(state.game.scenario==='asia')physical.context.forEach((r,i)=>svg('path',{d:r.path,fill:contextColor(i),'fill-opacity':.58,stroke:'#adbdc0','stroke-width':.3,'vector-effect':'non-scaling-stroke','fill-rule':'evenodd'},map));
      for(const r of getScenario().regions)svg('path',{d:r.overviewPath,'data-mini-region':r.id,'fill-rule':'evenodd','fill-opacity':.64,stroke:'#acbdbb','stroke-width':.4,'vector-effect':'non-scaling-stroke'},map);
      svg('rect',{id:'mini-view',fill:'#ffffff','fill-opacity':.15,stroke:'#3e736b','stroke-width':1.4,'vector-effect':'non-scaling-stroke','pointer-events':'none'},map);
      state.miniKey=state.game.scenario;
    }
    const ownership=frameOnly&&state.miniOwners?state.miniOwners:state.game.provinces.map(p=>p.owner).join('|');
    if(state.miniOwners!==ownership)for(const el of map.querySelectorAll('[data-mini-region]')){
      const r=getScenario().regions.find(r=>r.id===el.dataset.miniRegion),votes={};
      for(const id of r.children){const p=province(id);votes[p.owner]=(votes[p.owner]||0)+p.bounds[2]*p.bounds[3];}
      const owner=Object.keys(votes).sort((a,b)=>votes[b]-votes[a])[0];el.setAttribute('fill',faction(owner)?.color||neutralColor(r.name));
    }
    state.miniOwners=ownership;
    const v=state.view,rect=$('mini-view');
    for(const [key,value] of Object.entries({x:v.x,y:v.y,width:v.w,height:v.h}))setAttr(rect,key,value);
    setText($('mini-zoom'),`${zoomLevel().toFixed(1)}×`);
  }
  function initMinimap(){
    const map=$('mini-map');let dragging=false;
    function locate(e){
      if(!state.game)return;const b=miniBounds(),r=map.getBoundingClientRect(),width=r.width||220,height=r.height||129;
      const scale=Math.min(width/b[2],height/b[3]),ox=(width-b[2]*scale)/2,oy=(height-b[3]*scale)/2;
      const x=b[0]+Math.max(0,Math.min(width-2*ox,e.clientX-r.left-ox))/scale,y=b[1]+Math.max(0,Math.min(height-2*oy,e.clientY-r.top-oy))/scale;
      stopCameraMotion();state.homeView=false;state.view.x=x-state.view.w/2;state.view.y=y-state.view.h/2;
      enforceProvinceZoom(areaAtPoint(x,y));clampView();
      scheduleMapFrame();
    }
    map.addEventListener('pointerdown',e=>{if(!state.game||e.button!==0)return;dragging=state.miniDragging=true;map.setPointerCapture?.(e.pointerId);locate(e);e.preventDefault();});
    map.addEventListener('pointermove',e=>{if(dragging)locate(e);});
    function stop(e){if(!dragging)return;dragging=state.miniDragging=false;if(map.hasPointerCapture?.(e.pointerId))map.releasePointerCapture(e.pointerId);save();scheduleMapFrame();}
    map.addEventListener('pointerup',stop);map.addEventListener('pointercancel',stop);map.addEventListener('lostpointercapture',()=>{dragging=state.miniDragging=false;scheduleMapFrame();});
  }
  const sourceLinks={
    han:['三国州郡底本 · Esiymbro / 建安郡国图','https://commons.wikimedia.org/wiki/File:Jian%27an_Commanderies.svg'],
    republican:['民国省界底本 · Lilauid / 1936 政区图','https://commons.wikimedia.org/wiki/File:Republic_of_China_edcp_location_map_1936.svg'],
    empire:['亚洲历史 GIS · Konrad Lawson / 原始图源目录','https://froginawell.net/reference/japanese-empire/sources.html'],
    fuling:['涪陵改郡沿革 · 重庆地方志','https://dfz.cq.gov.cn/fzyd/qk/202509/P020250929506134778061.pdf'],
    tianshui:['天水建置沿革 · 天水地方志','https://www.tianshui.gov.cn/dsb/info/1783/27662.htm'],
    cshapes:['历史国家外缘 · ETH CShapes 2','https://icr.ethz.ch/data/cshapes/']
  };
  function historyInfo(p){
    const link=sourceLinks[p.source]||sourceLinks.empire;
    return `<details class="history-note" open><summary>历史依据与边界精度</summary><p><b>${esc(p.basis)}</b></p><p>${esc(p.note)}</p><a href="${link[1]}" target="_blank" rel="noopener noreferrer">${esc(link[0])} ↗</a></details>`;
  }
  function renderMacroInspector(){
    const region=getScenario().regions.find(r=>r.id===state.macroSelected);if(!region)return;
    const ps=region.children.map(province).filter(Boolean),total=ps.reduce((n,p)=>n+p.army,0);
    $('inspector-content').innerHTML=`<div class="territory-breadcrumb">${esc(getScenario().era)} · 概览</div><h2 class="territory-title">${esc(region.name)}</h2><p class="territory-description">放大后显示下列地块。每块保留独立兵力与经济；点击名称可以查看或下达命令。</p><div class="territory-metrics"><div class="metric"><span>下级地块</span><strong>${ps.length}</strong></div><div class="metric"><span>合计驻军</span><strong>${total}</strong></div></div><div class="inspector-divider"></div><div class="macro-children">${ps.map(p=>`<button data-child="${p.id}"><i style="background:${faction(p.owner)?.dark||'#a0aaa7'}"></i><span>${esc(p.name)}</span><small>${p.army}</small></button>`).join('')}</div><p class="action-hint">${esc(getScenario().historicalNote)}</p>`;
    $('inspector-content').querySelectorAll('[data-child]').forEach(b=>b.onclick=()=>{selectProvince(b.dataset.child);focusUnit(b.dataset.child);});
  }
  function selectMacro(id){
    const r=getScenario().regions.find(r=>r.id===id);if(!r)return;
    state.macroSelected=id;state.selected=state.countrySelected=null;state.source=state.target=null;state.layer='district';state.zoomArea=areaForUnit(province(r.children[0]));animateView(viewDestination(()=>{fitBounds(r.bounds,1.2);enforceProvinceZoom();clampView();}));save();render();
  }
  function mapSize(){if(!state.mapRect){const r=$('map').getBoundingClientRect();state.mapRect={width:r.width||900,height:r.height||680,left:r.left,top:r.top};}return state.mapRect;}
  function intersects(b,v=state.view){return b[0]<=v.x+v.w && b[0]+b[2]>=v.x && b[1]<=v.y+v.h && b[1]+b[3]>=v.y;}
  function zoomLevel(){return getScenario().homeBounds[2]/state.view.w;}
  function currentLOD(){
    if(state.layer!=='auto')return state.layer;
    if(state.zoomArea){const b=state.zoomArea.bounds,floor=Math.max(b[2],b[3]*mapSize().width/mapSize().height)*1.08;if(state.view.w<=floor*1.01)return 'district';}
    const z=zoomLevel();
    if(state.game.scenario==='three')return z<1.25?'overview':z<1.85?'region':'district';
    return z<1.05?'overview':z<2.6?'region':'district';
  }
  function makeScene(){
    const map=$('map');map.replaceChildren();
    const defs=svg('defs',{},map);
    const sea=svg('linearGradient',{id:'sea-tone',x1:0,x2:0,y1:0,y2:1},defs);
    svg('stop',{offset:'0%','stop-color':'#f4f8f9'},sea);svg('stop',{offset:'100%','stop-color':'#e9f1f4'},sea);
    const full=physical.fullBounds;
    svg('rect',{x:full[0]-100,y:full[1]-100,width:full[2]+200,height:full[3]+200,fill:'url(#sea-tone)'},map);
    // Geographic graticule is separate from political layers and never stretched.
    svg('path',{d:physical.land,fill:'#fcfcf9',stroke:'#c3cfd1','stroke-width':.7,'vector-effect':'non-scaling-stroke','fill-rule':'evenodd','pointer-events':'none'},map);
    const relief=svg('g',{id:'relief-layer','pointer-events':'none'},map);
    for(const img of physical.relief||[]){
      const b=img.bounds;svg('image',{x:b[0],y:b[1],width:b[2],height:b[3],href:img.url,preserveAspectRatio:'none','data-min-zoom':img.demZoom===5||state.game.scenario==='three'&&img.demZoom===8?0:img.minZoom},relief);
    }
    const context=svg('g',{id:'context-layer','pointer-events':'none'},map);
    if(state.game.scenario==='asia')physical.context.forEach((r,i)=>svg('path',{d:r.path,fill:contextColor(i),'fill-opacity':.38,stroke:'#aebdc3','stroke-width':.7,'vector-effect':'non-scaling-stroke','fill-rule':'evenodd'},context));
    svg('g',{id:'territory-layer'},map);
    svg('g',{id:'district-border-layer','pointer-events':'none'},map);
    svg('g',{id:'macro-layer'},map);
    svg('g',{id:'national-layer'},map);
    svg('g',{id:'water-layer','pointer-events':'none'},map);
    svg('g',{id:'route-layer','pointer-events':'none'},map);
    svg('g',{id:'label-layer','pointer-events':'none'},map);
    state.sceneKey=state.game.scenario;state.lod=null;state.territoryKey=null;state.presentation=null;state.labelNodes.clear();state.labelLayoutAt=-Infinity;state.labelLayoutKey=null;state.miniOwners=null;motionCache?.invalidate();waterLayer();
  }
  function smoothStep(a,b,value){const t=Math.max(0,Math.min(1,(value-a)/(b-a)));return t*t*(3-2*t);}
  function visualLevels(){
    let region=0,district=0;
    if(state.layer==='region')region=1;
    else if(state.layer==='district')region=district=1;
    else if(state.layer==='auto'){
      const z=zoomLevel(),three=state.game.scenario==='three';
      region=smoothStep(three?1.25:1.05,three?1.6:1.35,z);
      district=smoothStep(three?1.65:2.2,three?2.15:3,z);
      if(state.zoomArea){
        const b=state.zoomArea.bounds,floor=Math.max(b[2],b[3]*mapSize().width/mapSize().height)*1.08;
        const nearFloor=smoothStep(.75,.99,floor/state.view.w);region=Math.max(region,nearFloor);district=Math.max(district,nearFloor);
      }
    }
    return {national:1-region,administration:region,district,regions:region*(1-district),details:smoothStep(.45,.95,district)};
  }
  function layerOpacity(el,value,interactive=false){
    setAttr(el,'opacity',value.toFixed(4));setAttr(el,'visibility',value<.002?'hidden':'visible');
    const pointer=interactive&&value>.5?'auto':'none';if(el.style.pointerEvents!==pointer)el.style.pointerEvents=pointer;
  }
  function waterLayer(){
    const group=$('water-layer');group.replaceChildren();
    const groups=[group,svg('g',{'data-water-detail':'region'},group),svg('g',{'data-water-detail':'district'},group)];
    const target=rank=>groups[rank<=4?0:rank<=7?1:2];
    for(const lake of physical.lakes)if(lake.rank<=12)svg('path',{d:lake.path,fill:'#e4eff4',stroke:'#b5d0db','stroke-width':.55,'vector-effect':'non-scaling-stroke','fill-rule':'evenodd'},target(lake.rank));
    for(const r of physical.rivers){
      if(r.rank>12||state.game.scenario==='asia'&&/huang|yellow/i.test(r.name))continue;
      svg('path',{d:r.path,fill:'none',stroke:'#88b3c8','stroke-width':r.rank<4?1.1:.6,'vector-effect':'non-scaling-stroke','stroke-linecap':'round',opacity:.84},target(r.rank));
    }
    if(state.game.scenario==='asia')for(const d of physical.yellow1941)svg('path',{d,fill:'none',stroke:'#659ebc','stroke-width':1.5,'vector-effect':'non-scaling-stroke','stroke-linecap':'round'},group);
  }
  function drawTerritories(){
    // Keep geographic paths mounted while the camera moves. Only control or
    // selection changes rebuild them, so a zoom frame updates cheap attributes.
    const key=[state.game.scenario,state.mode,state.selected,state.source,state.target,state.macroSelected,state.countrySelected,state.game.provinces.map(p=>p.owner+':'+p.army).join('|')].join('/');
    if(state.territoryKey===key)return;
    const group=$('territory-layer'),macroLayer=$('macro-layer'),national=$('national-layer'),borders=$('district-border-layer');
    [group,macroLayer,national,borders].forEach(g=>g.replaceChildren());
    for(const c of countries()){
      const el=svg('path',{d:c.path,fill:c.color,'fill-opacity':.38,stroke:'none','fill-rule':'evenodd',class:'country-shape','data-country':c.id},national);
      svg('path',{d:c.outlinePath,fill:'none',stroke:state.countrySelected===c.id?'#35665e':'#81969b','stroke-width':state.countrySelected===c.id?2.2:1.1,'vector-effect':'non-scaling-stroke','pointer-events':'none',class:'country-border'},national);
      const title=svg('title',{},el);title.textContent=c.name;
      el.addEventListener('click',e=>{if(state.suppressClick)return;e.stopPropagation();selectCountry(c.id);});
    }
    for(const p of state.game.provinces){
      const own=p.owner===state.game.player,color=faction(p.owner)?.color||neutralColor(p.parent),selected=[state.selected,state.source,state.target].includes(p.id);
      const el=svg('path',{d:p.path,fill:color,'fill-opacity':state.mode==='control'?.38:own?.17:.1,stroke:selected?'#35665e':'none','stroke-width':2.2,'vector-effect':'non-scaling-stroke',class:'province-shape','fill-rule':'evenodd','data-unit':p.id},group);
      svg('path',{d:p.path,fill:'none',stroke:'#9aaaab','stroke-width':state.game.scenario==='three'?.85:.7,'vector-effect':'non-scaling-stroke','fill-rule':'evenodd','data-unit-border':p.id},borders);
      const title=svg('title',{},el);title.textContent=`${p.parent} / ${p.name} · ${p.kind} · 驻军 ${p.army}`;
      el.addEventListener('click',e=>{if(state.suppressClick)return;e.stopPropagation();selectProvince(p.id);});
    }
    for(const r of getScenario().regions){
      const el=svg('path',{d:r.path,fill:'transparent',stroke:r.id===state.macroSelected?'#34685e':'#7a9097','stroke-width':r.id===state.macroSelected?1.9:1,'vector-effect':'non-scaling-stroke','fill-rule':'evenodd','data-region':r.id,class:'macro-shape'},macroLayer);
      el.addEventListener('click',e=>{if(state.suppressClick)return;e.stopPropagation();selectMacro(r.id);});
    }
    state.territoryKey=key;state.miniOwners=null;
  }
  function drawLabels(levels,dt,initial,now,navigating,force){
    const key=[state.layer,state.selected,...['national','regions','district','administration'].map(k=>levels[k]>.002)].join('|');
    if(!force&&!initial&&key===state.labelLayoutKey&&navigating&&now-state.labelLayoutAt<90)return animateLabels(levels,dt,false);
    state.labelLayoutAt=now;state.labelLayoutKey=key;
    const group=$('label-layer'),v=state.view,size=mapSize(),unit=v.w/size.width,visible=[],wanted=new Set();let settling=false;
    function label(item,text,font,color,priority,tag,alpha,secondary=''){
      if(alpha<.002||item.x<v.x||item.x>v.x+v.w||item.y<v.y||item.y>v.y+v.h)return;
      visible.push({item,text,font,color,priority,tag,alpha,secondary});
    }
    for(const c of countries())label(c,c.name,16,c.dark,c.id===state.game.player?9:7,'country',levels.national);
    if(state.game.scenario==='asia')for(const r of physical.context)label(r,r.name,12,'#81949e',1,'context',levels.national);
    for(const r of getScenario().regions){const ps=r.children.map(province);label(r,r.name,11,'#53666e',ps.some(p=>p.owner===state.game.player)?3:2,'region',levels.regions,`${ps.length} 地块`);}
    for(const p of state.game.provinces){
      const selected=p.id===state.selected,fits=p.bounds[2]/unit>38&&p.bounds[3]/unit>18;
      if(fits||selected)label(p,p.name,selected?12:10.5,selected?'#254d49':'#4f6167',selected?10:p.owner===state.game.player?4:2,'unit',levels.district,String(p.army));
    }
    for(const c of getScenario().cities){
      if(visible.some(l=>l.tag==='unit'&&l.text===c.name&&l.alpha>.5))continue;
      const importantThree=state.game.scenario==='three'&&c.importance>=2;
      label(c,c.name,importantThree&&c.importance>=3?12:10,'#566977',importantThree?(c.importance>=3?8:3):1,'city',c.importance>=2?levels.administration:levels.district);
    }
    const occupied={country:[],region:[],detail:[]};visible.sort((a,b)=>b.priority-a.priority);
    for(const item of visible){
      const {font,text,tag}=item,x=(item.item.x-v.x)/unit,y=(item.item.y-v.y)/unit;
      const w=Array.from(text).reduce((n,c)=>n+(/[^\x00-\xff]/.test(c)?1:.56),0)*font+12,h=font+10+(item.secondary?9:0);
      const key=tag+':'+(item.item.id||text),bucket=occupied[tag==='country'||tag==='context'?'country':tag==='region'?'region':'detail'];
      let record=state.labelNodes.get(key),placed=null;
      const offsets=tag==='city'?[[9,-7],[9,12],[-w/2,-15],[-w-8,-4]]:[[0,0],[0,-13],[0,13]];
      if(record?.offset)offsets.unshift(record.offset);
      for(const [dx,dy] of offsets){
        const b={x:x+dx-(tag==='city'?0:w/2),y:y+dy-h/2,w,h};
        if(b.x<0||b.y<0||b.x+w>size.width||b.y+h>size.height)continue;
        if(!bucket.some(a=>b.x<a.x+a.w+2&&b.x+b.w+2>a.x&&b.y<a.y+a.h+2&&b.y+b.h+2>a.y)){placed={...b,dx,dy};break;}
      }
      if(!placed&&item.priority<10)continue;
      placed ||= {x:x-w/2,y:y-h/2,w,h,dx:0,dy:0};bucket.push(placed);wanted.add(key);
      if(!record){
        const g=svg('g',{'data-label-type':tag,'data-label':text},group);
        const backdrop=tag==='city'?svg('circle',{cx:0,cy:0,r:2.3,fill:'#697e88',stroke:'#fff','stroke-width':1.2},g):svg('rect',{rx:4,fill:'#fff',opacity:.85,stroke:'#d8e0df','stroke-width':.5},g);
        const t=svg('text',{'font-family':'PingFang SC, Noto Sans SC, sans-serif','text-anchor':tag==='city'?'start':'middle','paint-order':'stroke',stroke:'#fcfdfb','stroke-width':2,'stroke-linejoin':'round'},g);
        const sub=item.secondary?svg('text',{'data-map-detail':'true','text-anchor':'middle','font-family':'sans-serif','font-size':8,fill:'#889795'},g):null;
        record={g,backdrop,t,sub,alpha:initial?item.alpha:0,offset:null,world:item.item,tag,detailTag:tag==='unit'?'details':'regions'};state.labelNodes.set(key,record);
      }
      record.offset=[placed.dx,placed.dy];setAttr(record.g,'transform',`translate(${item.item.x} ${item.item.y}) scale(${unit})`);
      if(tag!=='city')for(const [k,value] of Object.entries({x:placed.x-x,y:placed.y-y,width:w,height:h}))setAttr(record.backdrop,k,value);
      for(const [k,value] of Object.entries({x:placed.dx,y:placed.dy+3.6,'font-size':font,'font-weight':item.priority>=4?650:500,fill:item.color}))setAttr(record.t,k,value);setText(record.t,text);
      if(record.sub){setAttr(record.sub,'x',placed.dx);setAttr(record.sub,'y',placed.dy+13);setText(record.sub,item.secondary);setAttr(record.sub,'opacity',tag==='unit'?levels.details:levels.regions);}
      record.target=item.alpha;
    }
    for(const [key,record] of state.labelNodes)record.wanted=wanted.has(key);
    let seas=$('sea-labels');if(!seas)seas=svg('g',{id:'sea-labels'},group);
    if(!seas.childElementCount)for(const [lon,lat,text] of [[131,27,'太 平 洋'],[77,8,'印 度 洋']]){
      const [x,y]=projectPoint(lon,lat),g=svg('g',{transform:`translate(${x} ${y})`},seas);
      const t=svg('text',{fill:'#a5bac5','font-family':'PingFang SC, sans-serif','letter-spacing':2,'font-size':13,'text-anchor':'middle'},g);t.textContent=text;
      g.dataset.x=x;g.dataset.y=y;
    }
    for(const el of seas.children)setAttr(el,'transform',`translate(${el.dataset.x} ${el.dataset.y}) scale(${unit})`);
    return animateLabels(levels,dt,initial);
  }
  function animateLabels(levels,dt,initial){
    let settling=false;const unit=state.view.w/mapSize().width;
    for(const [key,record] of state.labelNodes){
      const weights={country:levels.national,context:levels.national,region:levels.regions,unit:levels.district,city:record.world.importance>=2?levels.administration:levels.district};
      const target=record.wanted?weights[record.tag]:0;
      record.alpha+=(target-record.alpha)*(initial?1:1-Math.exp(-dt/65));
      if(Math.abs(target-record.alpha)<.003)record.alpha=target;else settling=true;
      setAttr(record.g,'transform',`translate(${record.world.x} ${record.world.y}) scale(${unit})`);
      setAttr(record.g,'opacity',record.alpha.toFixed(4));setAttr(record.g,'visibility',record.alpha<.002?'hidden':'visible');
      if(record.sub)setAttr(record.sub,'opacity',levels[record.detailTag]);
      if(!record.wanted&&record.alpha===0){record.g.remove();state.labelNodes.delete(key);}
    }
    return settling;
  }
  // Spherical LAEA only for reference labels and scale. Geometry uses ellipsoidal
  // EPSG transformation generated by pyproj; this helper never defines borders.
  function projectPoint(lon,lat){
    const rad=Math.PI/180,phi=lat*rad,lambda=(lon-105)*rad,p0=30*rad,R=6371007;
    const k=Math.sqrt(2/(1+Math.sin(p0)*Math.sin(phi)+Math.cos(p0)*Math.cos(phi)*Math.cos(lambda)));
    return [1000+R*k*Math.cos(phi)*Math.sin(lambda)/10000,700-R*k*(Math.cos(p0)*Math.sin(phi)-Math.sin(p0)*Math.cos(phi)*Math.cos(lambda))/10000];
  }
  function inverseReference(x,y){
    const X=(x-1000)*10000,Y=(700-y)*10000,R=6371007,rho=Math.hypot(X,Y),p0=Math.PI/6;
    if(rho<.01)return [105,30];
    const c=2*Math.asin(Math.min(1,rho/(2*R)));
    return [105+Math.atan2(X*Math.sin(c),rho*Math.cos(p0)*Math.cos(c)-Y*Math.sin(p0)*Math.sin(c))*180/Math.PI,Math.asin(Math.cos(c)*Math.sin(p0)+Y*Math.sin(c)*Math.cos(p0)/rho)*180/Math.PI];
  }
  function geographicDistance(a,b){
    const rad=Math.PI/180,p=a[1]*rad,q=b[1]*rad,h=Math.sin((q-p)/2)**2+Math.cos(p)*Math.cos(q)*Math.sin((b[0]-a[0])*rad/2)**2;
    return 12742*Math.asin(Math.min(1,Math.sqrt(h)));
  }
  function updateScale(){
    const v=state.view,u=v.w/mapSize().width,cx=v.x+v.w/2,cy=v.y+v.h/2;
    const kmPerPixel=geographicDistance(inverseReference(cx-50*u,cy),inverseReference(cx+50*u,cy))/100,target=kmPerPixel*75;
    const exponent=10**Math.floor(Math.log10(target));const distance=[1,2,5,10].map(n=>n*exponent).reduce((a,b)=>Math.abs(a-target)<Math.abs(b-target)?a:b);
    $('scale-bar').style.width=`${distance/kmPerPixel}px`;$('scale-label').textContent=`约 ${distance} km`;
    const p=inverseReference(cx,cy),a=projectPoint(...p),b=projectPoint(p[0],Math.min(89,p[1]+.1));
    const compass=document.querySelector('.compass');compass.style.transform=`rotate(${Math.atan2(b[0]-a[0],a[1]-b[1])*180/Math.PI}deg)`;
  }
  function renderMap(now=performance.now(),frameOnly=false){
    if(!state.game)return;
    const initial=state.sceneKey!==state.game.scenario,navigating=Boolean(state.cameraMotion||state.drag?.moved||state.miniDragging);
    $('app').classList.toggle('is-navigating',navigating);
    if(initial)makeScene();
    const dt=Math.max(0,Math.min(80,now-state.lastFrame));state.lastFrame=now;
    const target=visualLevels();let settling=false;
    if(initial||!state.presentation)state.presentation={...target};
    else for(const k of Object.keys(target)){
      state.presentation[k]+=(target[k]-state.presentation[k])*(1-Math.exp(-dt/55));
      if(Math.abs(target[k]-state.presentation[k])<.002)state.presentation[k]=target[k];else settling=true;
    }
    const v=state.view,lod=currentLOD(),z=zoomLevel(),levels=state.presentation,map=$('map');
    setAttr(map,'viewBox',`${v.x} ${v.y} ${v.w} ${v.h}`);setAttr(map,'data-lod',lod);setAttr(map,'data-map-version',getScenario().mapVersion);
    if(!frameOnly||initial)drawTerritories();
    layerOpacity($('national-layer'),levels.national,lod==='overview');
    layerOpacity($('territory-layer'),levels.administration,lod==='district');
    layerOpacity($('macro-layer'),levels.administration,lod==='region');
    layerOpacity($('district-border-layer'),levels.district);
    for(const el of $('water-layer').querySelectorAll('[data-water-detail]'))layerOpacity(el,el.dataset.waterDetail==='region'?levels.administration:levels.district);
    settling=drawLabels(levels,dt,initial,now,navigating,!frameOnly)||settling;
    for(const img of $('relief-layer').children){const threshold=Number(img.dataset.minZoom);layerOpacity(img,threshold===0?1:smoothStep(threshold*.85,threshold*1.2,z));}
    const routes=$('route-layer'),routeKey=[state.source,state.target].join('|');
    if(routes.dataset.key!==routeKey){
      routes.replaceChildren();routes.dataset.key=routeKey;
      if(state.source&&state.target){const a=province(state.source),b=province(state.target);svg('path',{d:`M${a.x},${a.y}L${b.x},${b.y}`,fill:'none',stroke:'#326b60','stroke-width':2,'vector-effect':'non-scaling-stroke'},routes);}
    }
    layerOpacity(routes,levels.district);state.lod=lod;
    setText($('lod-badge'),({overview:'概览 · 国家',region:'州 / 省 / 领地',district:'省内 · 郡 / 地块 / 城市'})[lod]);
    if($('map-layer').value!==state.layer)$('map-layer').value=state.layer;if($('map-mode').value!==state.mode)$('map-mode').value=state.mode;
    setText($('asia-full'),state.game.scenario==='three'?'全域':'亚洲');setAttr($('asia-full'),'title',state.game.scenario==='three'?'查看三国完整战区':'浏览完整亚洲');
    setText($('map-subcaption'),state.source?'请选择相邻地块':'平滑缩放 · 细节随视野渐显');
    if(navigating&&motionCache?.prepare(v,state.cameraMotion?.to||v,mapSize(),state.territoryKey,state.game.provinces,getScenario().regions,countries()))motionCache.draw(v,levels,z,mapSize(),state.game.scenario);
    else motionCache?.hide();
    if(!navigating&&!settling&&motionCache?.context&&!state.cacheWarmJob){
      const warm=()=>{state.cacheWarmJob=null;if(state.cameraMotion||state.drag?.moved||state.miniDragging||state.wheelInput)return;motionCache.prepare(state.view,state.view,mapSize(),state.territoryKey,state.game.provinces,getScenario().regions,countries());};
      state.cacheWarmJob=window.requestIdleCallback?requestIdleCallback(warm,{timeout:700}):setTimeout(warm,120);
    }
    if(!frameOnly||!navigating||now-(state.hudAt||0)>100){updateScale();state.hudAt=now;}renderMinimap(frameOnly);if(settling||state.cameraMotion)scheduleMapFrame();
  }



  function renderInspector(){
    const box=$('inspector-content');
    $('inspector-panel').classList.toggle('hidden',!state.selected&&!state.macroSelected&&!state.countrySelected);
    if(state.countrySelected){renderCountryInspector();return;}
    if(state.macroSelected){renderMacroInspector();return;}
    if(!state.selected){box.innerHTML='<div class="inspector-placeholder"><div class="placeholder-icon">⌖</div><h2>等待命令</h2><p>在地图上选择一块领土，查看驻军、经济和可执行的行动。</p></div>';return;}
    const p=province(state.selected), s=getScenario(), own=p.owner===state.game.player, owner=p.owner==='neutral'?{name:'中立',dark:'#9ea9a2'}:s.factions[p.owner];
    const source=state.source?province(state.source):null, isTarget=state.target===p.id&&source&&neighbors(source,p);
    let controls='';
    if(own){
      controls=`<div class="inspector-divider"></div><div class="action-title">内政行动</div><button id="recruit-btn" class="action-btn" ${state.game.gold[state.game.player]<12?'disabled':''}>征召 6 名新兵 <small>−12 国库</small></button><button id="develop-btn" class="action-btn" ${state.game.gold[state.game.player]<24?'disabled':''}>发展地区经济 <small>−24 国库</small></button><p class="action-hint">发展一次后，每回合收入 +2。</p>`;
      const near=adjacents(p);
      controls+=`<div class="inspector-divider"></div><div class="action-title">相邻领土</div><div class="neighbor-list">${near.map(q=>`<button class="neighbor-chip" data-neighbor="${q.id}">${esc(q.name)}${isSeaLink(p.id,q.id)?' ⛵':''}</button>`).join('')}</div><p class="action-hint">点击相邻地块指定目标；⛵ 表示游戏海路。</p>`;
    } else if(!source){controls='<div class="inspector-divider"></div><p class="action-hint">先选择己方领土，再选择相邻敌方领土，即可发起进攻。</p>';}
    if(isTarget){
      const max=Math.max(0,source.army-1);state.troops=Math.min(Math.max(1,state.troops),Math.max(1,max));
      controls+=`<div class="inspector-divider"></div><div class="action-title">从 ${esc(source.name)} ${own?'行军':'进攻'}</div><div class="selection-banner">出发地驻军 ${source.army} · 最多可派遣 ${max} 名士兵${p.terrain==='mountain'?' · 山地防御更强':''}${!own&&!isAtWar(source.owner,p.owner)?' · 此行动将对该国宣战':''}</div><input id="troop-input" class="troop-input" type="range" min="1" max="${Math.max(1,max)}" value="${state.troops}" ${max<1?'disabled':''}><div class="troop-range"><span>1 名</span><b id="troop-count">${state.troops} 名</b><span>${max} 名</span></div><button id="move-btn" class="action-btn strong" style="margin-top:14px" ${max<1?'disabled':''}>${own?'派遣部队':isAtWar(source.owner,p.owner)?'发起进攻':'宣战并进攻'} <small>→</small></button>`;
    }
    box.innerHTML=`<div class="territory-breadcrumb"><button id="parent-region">${esc(p.parent)}</button><span>› ${esc(p.kind)}</span></div><h2 class="territory-title">${esc(p.name)}</h2><div class="territory-sub"><span class="owner-pill" style="color:${owner.dark}">${esc(owner.name)}</span><span>·</span><span>${terrainName[p.terrain]}</span></div><p class="territory-description">${p.terrain==='mountain'?'山势险峻，易守难攻。':p.terrain==='jungle'?'丛林密布，补给与行军更为困难。':p.terrain==='hill'?'丘陵起伏，守军略占地利。':'交通便利，适合发展与集结。'}</p><div class="territory-metrics"><div class="metric"><span>驻守兵力</span><strong>${p.army}<small>人</small></strong></div><div class="metric"><span>回合收入</span><strong>+${p.tax+p.level}<small>国库</small></strong></div><div class="metric"><span>经济等级</span><strong>${p.level/2+1}<small>级</small></strong></div><div class="metric"><span>地形</span><strong style="font-size:15px">${terrainName[p.terrain]}</strong></div></div>${controls}${historyInfo(p)}`;
    box.querySelector('#parent-region')?.addEventListener('click',()=>selectMacro(p.parent));
    box.querySelector('#recruit-btn')?.addEventListener('click',recruit);
    box.querySelector('#develop-btn')?.addEventListener('click',develop);
    box.querySelectorAll('[data-neighbor]').forEach(btn=>btn.onclick=()=>selectProvince(btn.dataset.neighbor));
    box.querySelector('#troop-input')?.addEventListener('input',e=>{state.troops=Number(e.target.value);$('troop-count').textContent=`${state.troops} 名`;});
    box.querySelector('#move-btn')?.addEventListener('click',moveOrAttack);
  }

  function selectProvince(id){
    const p=province(id), player=state.game.player;
    if(!p)return;state.macroSelected=state.countrySelected=null;state.zoomArea=areaForUnit(p);
    if(p.owner===player){
      if(state.source&&state.source!==id&&neighbors(province(state.source),p)){state.target=id;}
      else{state.source=id;state.target=null;state.troops=Math.max(1,Math.floor((p.army-1)*.65));}
    }else if(state.source&&neighbors(province(state.source),p)){state.target=id;}
    else if(state.source){state.target=null;toast('该领土与出发地不相邻');}
    state.selected=id;render();
  }
  function recruit(){const p=province(state.selected),g=state.game;if(!p||p.owner!==g.player||g.gold[g.player]<12)return;g.gold[g.player]-=12;p.army+=6;log(`${p.name}征召 6 名新兵。`);save();render();toast(`${p.name}新增 6 名士兵`);}
  function develop(){const p=province(state.selected),g=state.game;if(!p||p.owner!==g.player||g.gold[g.player]<24)return;g.gold[g.player]-=24;p.level+=2;log(`${p.name}发展经济，每回合收入增加 2。`);save();render();toast(`${p.name}的经济得到发展`);}
  function combat(attacker,defender,amount){
    const advantage={plain:1,hill:1.17,mountain:1.4,jungle:1.24}[defender.terrain];
    const attack=amount*(.82+Math.random()*.42), defense=defender.army*advantage*(.82+Math.random()*.38);
    if(attack>defense){const survivors=Math.max(1,Math.floor(amount*(.56+Math.random()*.23)));const oldOwner=defender.owner;defender.owner=attacker.owner;defender.army=survivors;return {win:true,oldOwner,survivors};}
    defender.army=Math.max(1,defender.army-Math.floor(amount*(.32+Math.random()*.28)));return {win:false,survivors:0};
  }
  function moveOrAttack(){
    const a=province(state.source),b=province(state.target),g=state.game;
    if(!a||!b||a.owner!==g.player||!neighbors(a,b)||a.army<2)return;
    if(b.owner!==g.player&&!isAtWar(a.owner,b.owner)){g.wars.push(warKey(a.owner,b.owner));log(`${faction(a.owner).name}向${faction(b.owner).name}宣战。`);}
    const amount=Math.min(a.army-1,Math.max(1,state.troops));a.army-=amount;
    if(b.owner===g.player){b.army+=amount;log(`${amount} 名士兵从${a.name}行军至${b.name}。`);toast(`部队已抵达${b.name}`);}
    else{const result=combat(a,b,amount);if(result.win){log(`${a.name}出兵攻占${b.name}，${result.survivors} 名士兵驻守。`);toast(`攻占${b.name}！`);}else{log(`${a.name}进攻${b.name}失利，敌军仍有 ${b.army} 名守军。`);toast(`进攻失利，${b.name}仍由守军控制`);}}
    state.source=state.target=null;state.selected=b.id;checkVictory();save();render();
  }
  function aiTurn(id){
    const g=state.game, own=owns(id);if(!own.length)return;
    const borders=own.map(p=>({p,enemies:adjacents(p).filter(q=>isAtWar(id,q.owner))})).filter(x=>x.enemies.length);
    if(!borders.length)return;
    const f=faction(id);
    const recruitAt=borders.sort((a,b)=>a.p.army-b.p.army)[0].p;
    if(g.gold[id]>=12){recruitAt.army+=6;g.gold[id]-=12;if(Math.random()<.24)log(`${f.name}在${recruitAt.name}集结部队。`);}
    const options=[];
    for(const {p,enemies} of borders)for(const q of enemies){if(p.army>q.army*({plain:1.25,hill:1.45,mountain:1.7,jungle:1.5}[q.terrain])+4)options.push({p,q,score:p.army-q.army*1.4+Math.random()*8});}
    options.sort((a,b)=>b.score-a.score);
    if(options.length){const {p,q}=options[0],amount=Math.max(1,Math.floor(p.army*.7));p.army-=amount;const result=combat(p,q,amount);if(result.win)log(`${f.name}攻占了${q.name}。`);else if(Math.random()<.3)log(`${f.name}进攻${q.name}未果。`);}
  }
  function endTurn(){
    if(!state.game||state.game.ended)return;
    const g=state.game,s=getScenario();state.source=state.target=null;
    for(const id of Object.keys(s.factions)){if(id!==g.player)aiTurn(id);}
    for(const id of Object.keys(s.factions)){g.gold[id]=(g.gold[id]||0)+income(id);}
    g.turn++;log(`第 ${g.turn} 回合开始。${s.factions[g.player].name}收入 +${income(g.player)}。`);
    checkVictory();save();render();toast(`第 ${g.turn} 回合 · 国库收入 +${income(g.player)}`);
  }
  function checkVictory(){
    const g=state.game;if(g.ended)return;
    const playerLands=owns(g.player).length;
    if(playerLands===0){g.ended=true;log('我方失去最后一块领土，战役结束。');toast('战役结束：我方领土尽失');}
    else if(g.provinces.every(p=>p.owner===g.player||p.owner==='neutral')){g.ended=true;log('所有敌对势力已被击败，战区统一！');toast('胜利！你统一了战区');}
  }

  function fitBounds(b,padding=1.08,mode='contain'){
    const ratio=mapSize().width/mapSize().height;let w=Math.max(b[2]*padding,3),h=Math.max(b[3]*padding,3);
    if(mode==='cover'){if(w/h<ratio)h=w/ratio;else w=h*ratio;}
    else if(w/h<ratio)w=h*ratio;else h=w/ratio;
    state.homeView=false;
    state.view={x:b[0]+b[2]/2-w/2,y:b[1]+b[3]/2-h/2,w,h};
  }
  function resetView(){
    if(!state.game)return;const s=getScenario();
    if(state.game.scenario==='three'){
      fitBounds(s.coreBounds,.88,'cover');
      // Focus on the densely occupied Central Plains / Yangtze theatre.
      state.view.x+=s.coreBounds[2]*.045;state.view.y+=s.coreBounds[3]*.065;
      const cities=s.cities.filter(c=>c.importance>=3);
      for(const [axis,length] of [['x','w'],['y','h']]){
        const span=state.view[length],lo=Math.max(...cities.map(c=>c[axis]))-span*.4,hi=Math.min(...cities.map(c=>c[axis]))+span*.4;
        if(lo<=hi)state.view[axis]=Math.max(lo,Math.min(hi,state.view[axis]+span/2))-span/2;
      }
    }else fitBounds(s.homeBounds,1.02);
    state.homeView=true;
  }
  function focusUnit(id){const p=province(id);if(!p)return;state.layer='district';state.zoomArea=areaForUnit(p);animateView(viewDestination(()=>{fitBounds(state.zoomArea.bounds,1.08);clampView();}));renderMap();save();}
  function clampView(){
    if(state.game.scenario==='three'){
      const v=state.view,b=getScenario().campaignBounds;
      const clamp=(origin,length,start,span)=>length>=span?start+(span-length)/2:Math.max(start-length*.06,Math.min(start+span-length*.94,origin));
      v.x=clamp(v.x,v.w,b[0],b[2]);v.y=clamp(v.y,v.h,b[1],b[3]);return;
    }
    const v=state.view,b=physical.fullBounds;
    v.x=Math.max(b[0]-v.w*.12,Math.min(b[0]+b[2]-v.w*.88,v.x));v.y=Math.max(b[1]-v.h*.12,Math.min(b[1]+b[3]-v.h*.88,v.y));
  }
  function viewDestination(action){
    const current=state.view;state.view={...(state.cameraMotion?.to||current)};
    try{action();return {...state.view};}finally{state.view=current;}
  }
  function stopCameraMotion(){state.cameraMotion=null;state.wheelInput=null;$('map').classList.remove('zooming');motionCache?.invalidate();}
  function applyPanInput(){
    const e=state.panInput,d=state.drag;state.panInput=null;if(!e||!d)return;
    state.homeView=false;const r=mapSize();state.view.x=d.view.x-(e.x-d.x)*d.view.w/r.width;state.view.y=d.view.y-(e.y-d.y)*d.view.h/r.height;
    if(enforceProvinceZoom(areaAtPoint(state.view.x+state.view.w/2,state.view.y+state.view.h/2))){d.view={...state.view};d.x=e.x;d.y=e.y;}clampView();
  }
  function scheduleMapFrame(){if(state.frameRequest===null)state.frameRequest=requestAnimationFrame(mapFrame);}
  function animateView(to,duration=340){
    const from={...state.view};
    if(['x','y','w','h'].every(k=>Math.abs(to[k]-from[k])<1e-7)){stopCameraMotion();return;}
    state.cameraMotion={from,to,start:performance.now(),duration};$('map').classList.add('zooming');scheduleMapFrame();
  }
  function mapFrame(now){
    state.frameRequest=null;if(!state.game)return;
    const input=state.wheelInput;state.wheelInput=null;if(input)zoom(input.factor,input.px,input.py);applyPanInput();
    const motion=state.cameraMotion;
    if(motion){
      const t=Math.max(0,Math.min(1,(now-motion.start)/motion.duration)),ease=1-(1-t)**3;
      // Logarithmic scale feels even at both national and provincial distances.
      // Match translation to that scale to preserve the cursor's zoom anchor.
      const w=motion.from.w*Math.exp(Math.log(motion.to.w/motion.from.w)*ease);
      const f=Math.abs(motion.to.w-motion.from.w)>1e-7?(w-motion.from.w)/(motion.to.w-motion.from.w):ease;
      state.view={x:motion.from.x+(motion.to.x-motion.from.x)*f,y:motion.from.y+(motion.to.y-motion.from.y)*f,w,h:motion.from.h+(motion.to.h-motion.from.h)*f};
      if(t===1){state.view={...motion.to};stopCameraMotion();save();}
    }
    renderMap(now,true);
  }
  function zoom(factor,px=.5,py=.5){
    if(!state.game)return;const wasMoving=Boolean(state.cameraMotion);state.homeView=false;state.layer='auto';
    const to=viewDestination(()=>{
      const v=state.view,old=v.w,b=getScenario().campaignBounds,max=state.game.scenario==='three'?Math.max(b[2],b[3]*mapSize().width/mapSize().height)*1.04:physical.fullBounds[2]*1.12;
      const area=areaAtPoint(v.x+old*px,v.y+v.h*py);state.zoomArea=area;
      const w=Math.min(max,old*factor),h=v.h*w/old;v.x+=(old-w)*px;v.y+=(v.h-h)*py;v.w=w;v.h=h;enforceProvinceZoom(area);clampView();
    });
    animateView(to);if(!wasMoving)save();
  }
  function performSearch(){
    const value=$('map-search').value.trim();const list=$('map-search-results');list.replaceChildren();
    if(!state.game||!value){list.classList.add('hidden');return;}
    const s=getScenario(),candidates=[];
    for(const c of countries())if(c.name.includes(value))candidates.push({label:c.name,detail:'国家',action:()=>selectCountry(c.id)});
    for(const r of s.regions)if(r.name.includes(value))candidates.push({label:r.name,detail:'概览区域',action:()=>selectMacro(r.id)});
    for(const p of state.game.provinces)if(p.name.includes(value)||p.search?.some(x=>x.toLowerCase().includes(value.toLowerCase())))candidates.push({label:p.name,detail:p.parent+' · '+p.kind,action:()=>{selectProvince(p.id);focusUnit(p.id);}});
    for(const c of s.cities)if(c.name.includes(value))candidates.push({label:c.name,detail:'历史城市',action:()=>{state.layer='district';state.zoomArea=areaAtPoint(c.x,c.y);animateView(viewDestination(()=>{fitBounds(state.zoomArea.bounds,1.08);clampView();}));renderMap();save();}});
    for(const c of candidates.slice(0,10)){const b=document.createElement('button');b.innerHTML=`<strong>${esc(c.label)}</strong><small>${esc(c.detail)}</small>`;b.onclick=()=>{c.action();list.classList.add('hidden');};list.appendChild(b);}
    if(!candidates.length){const p=document.createElement('p');p.textContent='该剧本中没有此名称，试试当时的名称。';list.appendChild(p);}list.classList.remove('hidden');
  }
  function initMapControls(){
    const map=$('map');
    function schedule(){scheduleMapFrame();}
    map.addEventListener('wheel',e=>{if(!state.game||!e.deltaY)return;e.preventDefault();const r=mapSize(),delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?r.height:1);state.wheelInput={factor:(state.wheelInput?.factor||1)*Math.exp(Math.max(-120,Math.min(120,delta))*.002),px:(e.clientX-r.left)/r.width,py:(e.clientY-r.top)/r.height};scheduleMapFrame();},{passive:false});
    map.addEventListener('pointerdown',e=>{
      if(!state.game||e.button>0)return;state.suppressClick=false;
      stopCameraMotion();
      state.drag={x:e.clientX,y:e.clientY,view:{...state.view},pointerId:e.pointerId,moved:false};
    });
    map.addEventListener('pointermove',e=>{
      const d=state.drag;if(!d||d.pointerId!==e.pointerId)return;
      if(!d.moved && Math.hypot(e.clientX-d.x,e.clientY-d.y)<5)return;
      if(!d.moved){d.moved=true;map.setPointerCapture?.(e.pointerId);map.classList.add('panning');}
      state.panInput={x:e.clientX,y:e.clientY};schedule();
    });
    const stop=e=>{if(!state.drag)return;applyPanInput();state.suppressClick=state.drag.moved;state.drag=null;map.classList.remove('panning');if(map.hasPointerCapture?.(e.pointerId))map.releasePointerCapture(e.pointerId);save();scheduleMapFrame();setTimeout(()=>state.suppressClick=false,0);};
    map.addEventListener('pointerup',stop);map.addEventListener('pointercancel',stop);map.addEventListener('lostpointercapture',()=>{applyPanInput();state.drag=null;map.classList.remove('panning');scheduleMapFrame();});
    // A click can arrive on the SVG root while a bitmap frame is in use.
    map.addEventListener('click',e=>{
      if(e.target!==map||state.suppressClick||!state.game)return;const r=mapSize(),v=state.view,x=v.x+(e.clientX-r.left)*v.w/r.width,y=v.y+(e.clientY-r.top)*v.h/r.height;
      const p=state.game.provinces.find(p=>x>=p.bounds[0]&&x<=p.bounds[0]+p.bounds[2]&&y>=p.bounds[1]&&y<=p.bounds[1]+p.bounds[3]&&insidePath(x,y,p.path));if(!p)return;
      if(currentLOD()==='overview')selectCountry(p.owner==='neutral'?'neutral:'+p.parent:p.owner);else if(currentLOD()==='region')selectMacro(p.parent);else selectProvince(p.id);
    });
    $('zoom-in').onclick=()=>zoom(.75);$('zoom-out').onclick=()=>zoom(1.333333);$('zoom-reset').onclick=()=>{if(!state.game)return;state.layer='auto';state.zoomArea=null;animateView(viewDestination(resetView));renderMap();save();};
    $('asia-full').onclick=()=>{if(!state.game)return;state.layer='auto';state.zoomArea=null;animateView(viewDestination(()=>{fitBounds(state.game.scenario==='three'?getScenario().campaignBounds:physical.fullBounds,1.02);clampView();}));renderMap();save();};
    $('focus-selected').onclick=()=>{if(!state.game)return;if(state.selected)focusUnit(state.selected);else if(state.macroSelected)selectMacro(state.macroSelected);else if(state.countrySelected)selectCountry(state.countrySelected);else toast('先选择地块，或使用搜索定位');};
    $('map-layer').onchange=e=>{state.layer=e.target.value;renderMap();save();};
    $('map-mode').onchange=e=>{state.mode=e.target.value;renderMap();save();};
    $('map-search').addEventListener('input',performSearch);
    $('map-search').addEventListener('keydown',e=>{if(e.key==='Escape')$('map-search-results').classList.add('hidden');if(e.key==='Enter')$('map-search-results').querySelector('button')?.click();});
    $('map-wrap').addEventListener('click',e=>{if(!e.target.closest('.map-search-box'))$('map-search-results').classList.add('hidden');});
    // Re-fit on viewport changes while preserving the centre and horizontal span.
    let resizePending;window.addEventListener('resize',()=>{clearTimeout(resizePending);resizePending=setTimeout(()=>{if(!state.game)return;state.mapRect=null;stopCameraMotion();motionCache?.invalidate();if(state.homeView)resetView();else{const v=state.view,cy=v.y+v.h/2;v.h=v.w*mapSize().height/mapSize().width;v.y=cy-v.h/2;enforceProvinceZoom();clampView();}renderMap();},80);});
  }


  function boot(){
    renderSetup();initMapControls();initMinimap();
    $('close-inspector').onclick=()=>{state.selected=state.source=state.target=state.macroSelected=state.countrySelected=null;render();};
    $('toggle-overview').onclick=()=>{const hidden=$('overview-body').classList.toggle('hidden');$('toggle-overview').textContent=hidden?'+':'−';$('toggle-overview').setAttribute('aria-expanded',String(!hidden));$('toggle-overview').title=hidden?'展开概览':'收起概览';};
    $('start-btn').onclick=startGame;
    $('end-turn-btn').onclick=endTurn;
    $('new-game-btn').onclick=()=>{state.setupScenario=state.game?.scenario||'three';state.setupFaction=state.game?.player||'wei';renderSetup();$('resume-btn').classList.toggle('hidden',!state.game);$('setup-overlay').classList.remove('hidden');};
    $('resume-btn').onclick=()=>$('setup-overlay').classList.add('hidden');
    $('help-btn').onclick=()=>$('help-overlay').classList.remove('hidden');
    $('close-help').onclick=$('help-done').onclick=()=>$('help-overlay').classList.add('hidden');
    $('help-overlay').addEventListener('click',e=>{if(e.target===$('help-overlay'))$('help-overlay').classList.add('hidden');});
    try{
      const saved=JSON.parse(localStorage.getItem(SAVE_KEY));
      if(saved && scenarios[saved.scenario] && saved.mapVersion===scenarios[saved.scenario].mapVersion && Array.isArray(saved.provinces) && scenarios[saved.scenario].factions[saved.player]){
        const s=scenarios[saved.scenario],changes=new Map(saved.provinces.map(p=>[p.id,p]));
        if(changes.size!==s.units.length || s.units.some(p=>!changes.has(p.id)))throw new Error('存档地块版本不匹配');
        if(saved.provinces.some(p=>!Number.isInteger(p.army)||p.army<0||!Number.isInteger(p.level)||p.level<0||!Number.isFinite(p.tax)||!(p.owner==='neutral'||s.factions[p.owner])))throw new Error('存档数据无效');
        state.game={...saved,wars:Array.isArray(saved.wars)?saved.wars.filter(k=>typeof k==='string'&&k.split('|').length===2&&k.split('|').every(id=>s.factions[id])):(s.initialWars||[]).map(pair=>warKey(...pair)),provinces:s.units.map(p=>({...p,...changes.get(p.id)}))};state.setupScenario=saved.scenario;state.setupFaction=saved.player;
        state.layer=['auto','overview','region','district'].includes(saved.layer)?saved.layer:saved.layer==='city'?'district':'auto';state.mode='control';
        if(saved.cameraAtHome!==true&&saved.zoomAreaKey?.startsWith('region:')){const r=s.regions.find(r=>r.id===saved.zoomAreaKey.slice(7));if(r)state.zoomArea={key:saved.zoomAreaKey,name:r.name,bounds:r.bounds};}
        else if(saved.cameraAtHome!==true&&saved.zoomAreaKey?.startsWith('unit:'))state.zoomArea=areaForUnit(province(saved.zoomAreaKey.slice(5)));
        const updateThreeCamera=saved.scenario==='three'&&saved.cameraVersion!==1;
        resetView();if(!updateThreeCamera&&saved.cameraAtHome!==true&&saved.camera && Object.values(saved.camera).every(Number.isFinite) && saved.camera.w>0 && saved.camera.h>0){const h=saved.camera.w*mapSize().height/mapSize().width;state.view={...saved.camera,h,y:saved.camera.y+saved.camera.h/2-h/2};state.homeView=false;clampView();}
        if(enforceProvinceZoom()||updateThreeCamera){if(updateThreeCamera)state.layer='auto';save();}
        renderSetup();$('resume-btn').classList.remove('hidden');render();$('setup-overlay').classList.add('hidden');toast('已恢复历史地图战役');
      }else if(localStorage.getItem('shanhe-strategy-save-v1')){
        $('setup-intro').textContent='已保留旧地图存档。本版使用独立存档，选择剧本开始新的历史地图战役。';
      }
    }catch(err){console.warn('存档读取失败',err);toast('历史地图存档无法读取；原存档仍保留，可重新选择剧本。');}

  }
  boot();
})();
