(() => {
  'use strict';

  const SVG = 'http://www.w3.org/2000/svg';
  const SAVE_KEY = 'shanhe-strategy-save-v1';
  const $ = id => document.getElementById(id);
  const point = (x, y) => [x, y];

  // Provinces and coastlines are intentionally schematic: the game map is a playable
  // strategic illustration, rather than a claim of exact historical borders.
  const scenarios = {
    three: {
      name: '三国鼎立', era: '公元 222 年', subtitle: '魏、蜀、吴逐鹿中原', description: '汉室余晖，三分天下。北方兵强，西蜀据险，江东控水；谁能一统山河？', caption: '华夏战区', year: 222,
      factions: {
        wei: { name: '曹魏', short: '魏', color: '#a9b7b6', dark: '#587474', gold: 95, motto: '据中原，定四方' },
        shu: { name: '蜀汉', short: '蜀', color: '#b9c3a1', dark: '#728356', gold: 70, motto: '凭天险，兴汉室' },
        wu: { name: '东吴', short: '吴', color: '#b5c8c2', dark: '#678d83', gold: 78, motto: '守江东，图天下' }
      },
      outlines: {
        mainland: [[100,305],[125,263],[180,234],[225,202],[272,200],[321,159],[388,141],[445,113],[513,104],[562,80],[630,87],[696,69],[760,91],[818,102],[861,131],[911,146],[956,189],[984,226],[970,256],[932,272],[965,290],[1006,321],[1019,349],[991,369],[962,355],[937,375],[968,401],[984,430],[966,459],[936,472],[930,491],[920,523],[875,550],[823,539],[800,565],[758,580],[720,617],[671,627],[627,658],[578,643],[540,669],[486,663],[448,637],[399,645],[352,626],[302,634],[255,602],[207,590],[178,558],[144,544],[126,500],[93,475],[83,435],[96,391],[79,353]]
      },
      provinces: [
        ['liaodong','辽东',870,179,'wei','plain',17,5],['youzhou','幽州',746,196,'wei','plain',18,6],['jizhou','冀州',690,278,'wei','plain',21,8],['bingzhou','并州',548,268,'wei','hill',15,6],['liangzhou','凉州',330,233,'wei','mountain',13,5],['guanzhong','关中',492,355,'wei','hill',20,7],['qingzhou','青州',815,301,'wei','plain',17,7],['yanzhou','兖州',725,365,'wei','plain',19,8],['xuzhou','徐州',844,382,'wei','plain',17,7],['yuzhou','豫州',625,386,'wei','plain',22,8],['nanyang','南阳',589,455,'wei','hill',15,6],['hanzhong','汉中',446,449,'shu','mountain',15,5],['shangyong','上庸',510,501,'shu','mountain',11,4],['chengdu','成都',339,518,'shu','plain',22,8],['zizhong','资中',382,566,'shu','hill',12,5],['ba','巴郡',475,561,'shu','hill',14,5],['wudu','武都',335,420,'shu','mountain',11,4],['jianning','建宁',343,618,'shu','mountain',10,4],['yongchang','永昌',232,554,'shu','mountain',9,3],['jingbei','荆北',633,490,'wu','plain',16,6],['jingnan','荆南',601,574,'wu','hill',14,5],['jiangxia','江夏',721,478,'wu','plain',15,6],['yuzhang','豫章',751,545,'wu','hill',15,6],['lujiang','庐江',817,459,'wu','plain',15,7],['jianye','建业',895,416,'wu','plain',20,8],['wujun','吴郡',913,470,'wu','plain',15,6],['kuaiji','会稽',873,531,'wu','hill',14,6],['changsha','长沙',664,565,'wu','hill',13,5],['lingling','零陵',538,619,'wu','hill',12,4],['guangzhou','广州',712,597,'wu','plain',12,5],['jiaozhou','交州',618,631,'wu','plain',11,4]
      ],
      rivers: ['M 210 312 C 335 342, 400 330, 495 365 S 620 402, 725 393 S 855 375, 960 391','M 345 482 C 446 500, 517 482, 584 510 S 716 500, 785 517 S 878 514, 925 480','M 240 278 C 312 292, 362 325, 435 349'],
      mountains: [[252,341,8],[324,375,6],[335,465,7],[273,533,5],[402,493,5],[441,418,4],[552,191,4],[618,165,3],[492,597,4]],
      seaLinks: [['liangzhou','guanzhong'],['liangzhou','wudu']]
    },
    asia: {
      name: '二战亚洲', era: '公元 1941 年', subtitle: '烽火席卷亚太', description: '亚洲战云密布。海陆交通与工业腹地同样重要，各阵营将争夺广阔战区。', caption: '亚太战区', year: 1941,
      factions: {
        china: { name: '中国', short: '中', color: '#aec4ad', dark: '#648768', gold: 78, motto: '持久抵抗，守护山河' },
        japan: { name: '日本', short: '日', color: '#d3b6ab', dark: '#a47267', gold: 110, motto: '海陆并进，扩张战线' },
        uk: { name: '英国', short: '英', color: '#bbbdcf', dark: '#777d9f', gold: 80, motto: '固守交通要道' },
        us: { name: '美国', short: '美', color: '#b4c9d1', dark: '#668b9d', gold: 90, motto: '集结太平洋力量' },
        soviet: { name: '苏联', short: '苏', color: '#c8b9b4', dark: '#967b74', gold: 80, motto: '北方战线，重兵待命' },
        thailand: { name: '泰国', short: '泰', color: '#c4c9aa', dark: '#8d9864', gold: 44, motto: '守住半岛腹地' },
        dutch: { name: '荷属东印度', short: '荷', color: '#c5bdaa', dark: '#958568', gold: 48, motto: '保卫群岛资源' }
      },
      outlines: {
        north: [[54,83],[155,78],[269,95],[370,72],[491,70],[573,87],[688,62],[782,70],[864,75],[910,106],[954,141],[976,183],[963,230],[937,256],[955,283],[948,315],[918,337],[906,375],[922,401],[903,439],[876,470],[850,487],[813,465],[765,471],[722,452],[680,481],[628,470],[594,448],[545,464],[507,438],[455,445],[404,416],[369,449],[325,419],[283,435],[234,401],[194,405],[155,367],[119,376],[87,341],[67,289],[46,251],[43,183]],
        india: [[110,377],[159,352],[201,373],[248,374],[284,415],[320,432],[337,478],[329,530],[305,563],[273,596],[256,646],[230,687],[206,660],[182,606],[151,574],[123,529],[109,476],[96,436]],
        indochina: [[618,441],[671,448],[717,447],[768,452],[809,471],[832,502],[819,548],[786,567],[760,605],[752,661],[725,699],[701,697],[692,647],[711,611],[687,585],[650,562],[631,529],[614,497]],
        korea: [[960,238],[988,259],[999,294],[984,323],[962,335],[943,304],[946,270]],
        japan: [[1060,232],[1090,226],[1109,254],[1093,291],[1078,315],[1073,342],[1050,379],[1025,401],[1010,385],[1029,353],[1045,318],[1041,288]],
        philippines: [[1013,444],[1036,448],[1049,480],[1031,506],[1045,531],[1038,571],[1018,575],[1006,549],[1002,512],[997,472]],
        sumatra: [[788,629],[808,641],[841,695],[833,720],[808,706],[781,663]],
        java: [[845,716],[910,710],[974,721],[968,742],[898,739],[851,732]],
        borneo: [[886,562],[947,565],[966,603],[948,658],[906,673],[877,640],[868,594]]
      },
      provinces: [
        ['siberia','西伯利亚',402,137,'soviet','plain',22,5,'north'],['amur','远东',786,138,'soviet','hill',23,6,'north'],['mongolia','蒙古高原',540,236,'neutral','plain',10,3,'north'],['xinjiang','新疆',335,273,'china','mountain',11,4,'north'],['tibet','西藏',360,379,'china','mountain',9,3,'north'],['gansu','甘肃',490,331,'china','hill',13,5,'north'],['sichuan','四川',529,418,'china','mountain',20,8,'north'],['yunnan','云南',638,437,'china','mountain',13,5,'north'],['shaanxi','陕西',585,343,'china','hill',15,6,'north'],['henan','河南',686,342,'china','plain',15,7,'north'],['hubei','湖北',688,414,'china','plain',15,7,'north'],['hunan','湖南',756,434,'china','hill',13,6,'north'],['guangxi','广西',706,443,'china','hill',12,5,'north'],['chongqing','重庆',613,408,'china','mountain',17,7,'north'],['manchuria','满洲',825,217,'japan','plain',25,9,'north'],['beijing','华北',751,301,'japan','plain',20,8,'north'],['shandong','山东',812,346,'japan','plain',17,7,'north'],['jiangsu','江苏',851,389,'japan','plain',16,7,'north'],['shanghai','上海',907,397,'japan','plain',18,9,'north'],['zhejiang','浙江',867,440,'china','hill',14,7,'north'],['fujian','福建',822,462,'china','hill',12,6,'north'],['guangdong','广东',778,462,'china','plain',14,7,'north'],['assam','阿萨姆',206,422,'uk','hill',12,5,'india'],['bengal','孟加拉',244,483,'uk','plain',16,7,'india'],['delhi','德里',168,459,'uk','plain',17,8,'india'],['deccan','德干',218,581,'uk','hill',16,7,'india'],['madras','马德拉斯',245,643,'uk','plain',14,6,'india'],['burma','缅甸',656,519,'uk','mountain',15,6,'indochina'],['malaya','马来亚',730,643,'uk','jungle',14,7,'indochina'],['thailand','泰国',726,533,'thailand','plain',16,6,'indochina'],['laos','老挝',705,481,'thailand','mountain',11,4,'indochina'],['vietnam','越南',790,536,'japan','jungle',15,6,'indochina'],['korea-n','朝鲜北部',969,266,'japan','hill',12,5,'korea'],['korea-s','朝鲜南部',972,309,'japan','hill',12,5,'korea'],['kyushu','九州',1038,370,'japan','hill',14,6,'japan'],['honshu-w','本州西部',1056,321,'japan','hill',17,7,'japan'],['honshu-e','本州东部',1080,266,'japan','hill',20,9,'japan'],['luzon','吕宋',1020,477,'us','hill',17,7,'philippines'],['visayas','米沙鄢',1025,531,'us','hill',12,5,'philippines'],['mindanao','棉兰老',1027,561,'us','hill',12,5,'philippines'],['sumatra','苏门答腊',811,675,'dutch','jungle',14,7,'sumatra'],['java-w','爪哇西部',881,725,'dutch','plain',15,7,'java'],['java-e','爪哇东部',941,727,'dutch','plain',13,6,'java'],['borneo-w','婆罗洲西部',900,613,'dutch','jungle',11,5,'borneo'],['borneo-e','婆罗洲东部',936,615,'dutch','jungle',12,6,'borneo']
      ],
      rivers: ['M 388 291 C 477 306, 542 300, 612 319 S 748 358, 826 370 S 881 378, 928 386','M 541 379 C 620 399, 672 402, 724 421 S 788 429, 834 444','M 165 470 C 210 487, 235 513, 269 539','M 704 467 C 737 496, 742 530, 759 574 S 739 625, 738 667'],
      mountains: [[298,348,6],[384,361,6],[441,380,5],[510,388,4],[655,491,4],[695,501,3],[900,267,3],[255,431,3],[152,528,3]],
      seaLinks: [['tibet','assam'],['assam','burma'],['bengal','burma'],['yunnan','burma'],['guangxi','laos'],['guangdong','vietnam'],['manchuria','korea-n'],['shanghai','korea-s'],['korea-s','kyushu'],['honshu-w','kyushu'],['guangdong','luzon'],['vietnam','luzon'],['malaya','sumatra'],['malaya','borneo-w'],['sumatra','java-w'],['java-e','borneo-e'],['borneo-e','mindanao'],['mindanao','visayas']]
    }
  };

  const terrainName = { plain:'平原',hill:'丘陵',mountain:'山地',jungle:'丛林' };
  const state = { game:null, setupScenario:'three', setupFaction:'wei', selected:null, source:null, target:null, troops:1, view:{x:0,y:0,w:1200,h:760}, toastTimer:null };

  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function svg(tag, attrs={}, parent) { const e=document.createElementNS(SVG,tag); Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,String(v))); if(parent) parent.appendChild(e); return e; }
  function polygonPath(points) { return points.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')+' Z'; }
  function clip(poly, a, b, c) {
    const out=[];
    for(let i=0;i<poly.length;i++){
      const p=poly[i], q=poly[(i+1)%poly.length], dp=a*p[0]+b*p[1]-c, dq=a*q[0]+b*q[1]-c;
      if(dp<=0) out.push(p);
      if((dp<0&&dq>0)||(dp>0&&dq<0)){const t=dp/(dp-dq);out.push(point(p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])));}
    }
    return out;
  }
  function cellsFor(scenario, provinces) {
    const cells={};
    for(const p of provinces){
      let poly=scenario.outlines[p.group].map(q=>[...q]);
      for(const q of provinces){
        if(q===p||q.group!==p.group)continue;
        const a=2*(q.x-p.x), b=2*(q.y-p.y), c=q.x*q.x+q.y*q.y-p.x*p.x-p.y*p.y;
        poly=clip(poly,a,b,c);
        if(!poly.length)break;
      }
      cells[p.id]=poly;
    }
    return cells;
  }
  function getScenario(){return scenarios[state.game.scenario];}
  function province(id){return state.game.provinces.find(p=>p.id===id);}
  function faction(id){return getScenario().factions[id];}
  function owns(id){return state.game.provinces.filter(p=>p.owner===id);}
  function income(id){return owns(id).reduce((sum,p)=>sum+p.tax+p.level,0);}
  function army(id){return owns(id).reduce((sum,p)=>sum+p.army,0);}
  function log(message){state.game.log.unshift({turn:state.game.turn,message});state.game.log=state.game.log.slice(0,20);}
  function save(){if(!state.game)return;try{localStorage.setItem(SAVE_KEY,JSON.stringify(state.game));}catch(err){console.warn('存档写入失败',err);}}
  function toast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>el.classList.remove('show'),2900);}

  function neighbors(a,b){
    if(!a||!b||a.id===b.id)return false;
    const s=getScenario();
    if(s.seaLinks.some(pair=>pair.includes(a.id)&&pair.includes(b.id)))return true;
    if(a.group!==b.group)return false;
    const nearby=state.game.provinces.filter(p=>p.group===a.group&&p.id!==a.id).sort((p,q)=>Math.hypot(p.x-a.x,p.y-a.y)-Math.hypot(q.x-a.x,q.y-a.y)).slice(0,5);
    const nearbyBack=state.game.provinces.filter(p=>p.group===b.group&&p.id!==b.id).sort((p,q)=>Math.hypot(p.x-b.x,p.y-b.y)-Math.hypot(q.x-b.x,q.y-b.y)).slice(0,5);
    return (nearby.some(p=>p.id===b.id)||nearbyBack.some(p=>p.id===a.id))&&Math.hypot(a.x-b.x,a.y-b.y)<(state.game.scenario==='three'?175:195);
  }
  function adjacents(p){return state.game.provinces.filter(q=>neighbors(p,q));}

  function renderSetup(){
    $('scenario-options').innerHTML=Object.entries(scenarios).map(([id,s])=>`<button class="scenario-option ${id===state.setupScenario?'selected':''}" data-scenario="${id}"><span class="check">${id===state.setupScenario?'✓':''}</span><span class="era">${esc(s.era)} · SCENARIO</span><strong>${esc(s.name)}</strong><small>${esc(s.subtitle)}</small></button>`).join('');
    $('faction-options').innerHTML=Object.entries(scenarios[state.setupScenario].factions).map(([id,f])=>`<button class="faction-option ${id===state.setupFaction?'selected':''}" data-faction="${id}"><i style="background:${f.dark}"></i>${esc(f.name)}</button>`).join('');
    $('scenario-options').querySelectorAll('button').forEach(btn=>btn.onclick=()=>{state.setupScenario=btn.dataset.scenario;state.setupFaction=Object.keys(scenarios[state.setupScenario].factions)[0];renderSetup();});
    $('faction-options').querySelectorAll('button').forEach(btn=>btn.onclick=()=>{state.setupFaction=btn.dataset.faction;renderSetup();});
  }
  function startGame(){
    const s=scenarios[state.setupScenario];
    state.game={scenario:state.setupScenario,player:state.setupFaction,turn:1,gold:Object.fromEntries(Object.entries(s.factions).map(([id,f])=>[id,f.gold])),provinces:s.provinces.map(([id,name,x,y,owner,terrain,army,tax,group])=>({id,name,x,y,owner,terrain,army,tax,group:group||'mainland',level:0})),log:[],ended:false};
    state.selected=state.source=state.target=null;state.view={x:0,y:0,w:1200,h:760};
    log(`${s.factions[state.game.player].name}的征程开始了。`);save();$('setup-overlay').classList.add('hidden');$('resume-btn').classList.remove('hidden');render();toast('点击己方领土，开始下达命令');
  }

  function render(){
    if(!state.game)return;
    const s=getScenario(), p=state.game.player, f=s.factions[p], count=owns(p).length;
    $('scenario-name').textContent=s.name;
    $('turn-label').textContent=`第 ${state.game.turn} 回合 · ${s.year+state.game.turn-1} 年`;
    $('campaign-title').textContent=s.name;
    $('campaign-description').textContent=s.description;
    $('player-card').classList.remove('empty');$('player-card').innerHTML=`<span class="player-emblem" style="background:${f.dark}">${esc(f.short)}</span><div><strong>${esc(f.name)}</strong><small>${esc(f.motto)}</small></div>`;
    $('gold-stat').textContent=state.game.gold[p]||0;$('income-stat').textContent=`+${income(p)}`;$('province-stat').textContent=count;$('army-stat').textContent=army(p);
    $('faction-count').textContent=`${Object.keys(s.factions).length} 个势力`;
    $('faction-list').innerHTML=Object.entries(s.factions).map(([id,item])=>`<div class="faction-row ${id===p?'is-player':''}"><span class="faction-emblem" style="background:${item.dark}">${esc(item.short)}</span><span class="name">${esc(item.name)}${id===p?' · 你':''}</span><span class="territory-count">${owns(id).length} 领土</span></div>`).join('');
    $('event-log').innerHTML=state.game.log.map(item=>`<div class="log-item"><span class="turn-tag">回合 ${item.turn}</span>${esc(item.message)}</div>`).join('');
    $('map-caption').textContent=s.caption;
    $('map-subcaption').textContent=state.source?'请选择相邻领土作为目标':'点击领土查看详情';
    $('map-hint').textContent=state.source?`出发地：${province(state.source)?.name||''}`:'滚轮缩放 · 拖动地图浏览';
    $('end-turn-btn').disabled=state.game.ended;
    renderMap();renderInspector();
  }

  function mountain(parent,x,y,n){
    for(let i=0;i<n;i++){
      const xx=x+(i%4)*17+(Math.floor(i/4)%2)*8, yy=y+Math.floor(i/4)*17+(i%2)*4;
      const h=15+(i%3)*5,w=12+(i%2)*3;
      svg('path',{d:`M ${xx-w} ${yy} L ${xx} ${yy-h} L ${xx+w} ${yy} Z`,fill:'#c7d0c9',stroke:'#aebcb2','stroke-width':1,opacity:.86},parent);
      svg('path',{d:`M ${xx} ${yy-h} L ${xx+w} ${yy} L ${xx} ${yy} Z`,fill:'#a7b9ae',opacity:.57},parent);
      svg('path',{d:`M ${xx-5} ${yy-h+8} L ${xx} ${yy-h} L ${xx+6} ${yy-h+8}`,fill:'none',stroke:'#eff3ee','stroke-width':1.5},parent);
    }
  }
  function renderMap(){
    const map=$('map'), s=getScenario();map.replaceChildren();map.setAttribute('viewBox',`${state.view.x} ${state.view.y} ${state.view.w} ${state.view.h}`);
    const defs=svg('defs',{},map);const pattern=svg('pattern',{id:'grid',width:42,height:42,patternUnits:'userSpaceOnUse'},defs);svg('path',{d:'M 42 0 L 0 0 0 42',fill:'none',stroke:'#e8eeeb','stroke-width':.65},pattern);
    svg('rect',{x:0,y:0,width:1200,height:760,fill:'#f4f8f7'},map);svg('rect',{x:0,y:0,width:1200,height:760,fill:'url(#grid)'},map);
    const waterLabels=s===scenarios.three?[[1027,510,'东 海'],[924,666,'南 海']]:[[1040,631,'太 平 洋'],[410,682,'印 度 洋'],[994,426,'东 海']];
    waterLabels.forEach(([x,y,t])=>{const e=svg('text',{x,y,fill:'#c2d3d3','font-size':17,'letter-spacing':8,'font-family':'serif'},map);e.textContent=t;});
    const land=svg('g',{},map);
    Object.entries(s.outlines).forEach(([key,points])=>{svg('path',{d:polygonPath(points),fill:'#e6ebe5',stroke:'#d3dfd9','stroke-width':4,'stroke-linejoin':'round'},land);});
    const cells=cellsFor(s,state.game.provinces), provinceLayer=svg('g',{},map);
    for(const p of state.game.provinces){
      const color=p.owner==='neutral'?'#e9ede8':s.factions[p.owner].color;
      const selected=p.id===state.selected, source=p.id===state.source, target=p.id===state.target;
      const path=svg('path',{d:polygonPath(cells[p.id]),fill:color,stroke:selected?'#273e42':source?'#4c776a':target?'#576e6b':'#fff','stroke-width':selected?3.5:source||target?2.8:2,'stroke-linejoin':'round',class:'province-shape'},provinceLayer);
      path.style.cursor='pointer';path.addEventListener('click',e=>{e.stopPropagation();selectProvince(p.id);});
      const title=svg('title',{},path);title.textContent=`${p.name} · ${p.owner==='neutral'?'中立':s.factions[p.owner].name} · 驻军 ${p.army}`;
    }
    const rivers=svg('g',{'pointer-events':'none'},map);
    s.rivers.forEach(d=>{svg('path',{d,fill:'none',stroke:'#f8fbf9','stroke-width':8,opacity:.9},rivers);svg('path',{d,fill:'none',stroke:'#88b7bf','stroke-width':3.2,opacity:.86,'stroke-linecap':'round'},rivers);});
    const mts=svg('g',{'pointer-events':'none'},map);s.mountains.forEach(([x,y,n])=>mountain(mts,x,y,n));
    if(state.source&&state.target){const a=province(state.source),b=province(state.target);svg('path',{d:`M ${a.x} ${a.y} Q ${(a.x+b.x)/2} ${(a.y+b.y)/2-35} ${b.x} ${b.y}`,fill:'none',stroke:'#3f7469','stroke-width':2.5,'stroke-dasharray':'7 5','pointer-events':'none'},map);}
    const labels=svg('g',{'pointer-events':'none'},map);
    for(const p of state.game.provinces){
      const own=p.owner===state.game.player;
      const group=svg('g',{transform:`translate(${p.x} ${p.y})`},labels);
      svg('rect',{x:-25,y:-11,width:50,height:23,rx:7,fill:'#ffffff',opacity:own ? 0.94 : 0.83,stroke:own?'#d7e3dc':'#e6eae6','stroke-width':.8},group);
      const t=svg('text',{x:0,y:4,'text-anchor':'middle',fill:'#3d5052','font-size':11,'font-weight':own?700:600,'font-family':'Noto Sans SC, sans-serif'},group);t.textContent=p.name.length>4?p.name.slice(0,4):p.name;
      svg('circle',{cx:19,cy:13,r:6,fill:own?'#456c60':'#899a96',stroke:'#fff','stroke-width':1.3},group);
      const num=svg('text',{x:19,y:15.5,'text-anchor':'middle',fill:'#fff','font-size':6.5,'font-weight':700,'font-family':'sans-serif'},group);num.textContent=p.army;
    }
  }

  function renderInspector(){
    const box=$('inspector-content');
    if(!state.selected){box.innerHTML='<div class="inspector-placeholder"><div class="placeholder-icon">⌖</div><h2>等待命令</h2><p>在地图上选择一块领土，查看驻军、经济和可执行的行动。</p></div>';return;}
    const p=province(state.selected), s=getScenario(), own=p.owner===state.game.player, owner=p.owner==='neutral'?{name:'中立',dark:'#9ea9a2'}:s.factions[p.owner];
    const source=state.source?province(state.source):null, isTarget=state.target===p.id&&source&&neighbors(source,p);
    let controls='';
    if(own){
      controls=`<div class="inspector-divider"></div><div class="action-title">内政行动</div><button id="recruit-btn" class="action-btn" ${state.game.gold[state.game.player]<12?'disabled':''}>征召 6 名新兵 <small>−12 国库</small></button><button id="develop-btn" class="action-btn" ${state.game.gold[state.game.player]<24?'disabled':''}>发展地区经济 <small>−24 国库</small></button><p class="action-hint">发展一次后，每回合收入 +2。</p>`;
      const near=adjacents(p);
      controls+=`<div class="inspector-divider"></div><div class="action-title">相邻领土</div><div class="neighbor-list">${near.map(q=>`<button class="neighbor-chip" data-neighbor="${q.id}">${esc(q.name)}</button>`).join('')}</div><p class="action-hint">点击相邻领土，指定行军或进攻目标。</p>`;
    } else if(!source){controls='<div class="inspector-divider"></div><p class="action-hint">先选择己方领土，再选择相邻敌方领土，即可发起进攻。</p>';}
    if(isTarget){
      const max=Math.max(0,source.army-1);state.troops=Math.min(Math.max(1,state.troops),Math.max(1,max));
      controls+=`<div class="inspector-divider"></div><div class="action-title">从 ${esc(source.name)} ${own?'行军':'进攻'}</div><div class="selection-banner">出发地驻军 ${source.army} · 最多可派遣 ${max} 名士兵${p.terrain==='mountain'?' · 山地防御更强':''}</div><input id="troop-input" class="troop-input" type="range" min="1" max="${Math.max(1,max)}" value="${state.troops}" ${max<1?'disabled':''}><div class="troop-range"><span>1 名</span><b id="troop-count">${state.troops} 名</b><span>${max} 名</span></div><button id="move-btn" class="action-btn strong" style="margin-top:14px" ${max<1?'disabled':''}>${own?'派遣部队':'发起进攻'} <small>→</small></button>`;
    }
    box.innerHTML=`<h2 class="territory-title">${esc(p.name)}</h2><div class="territory-sub"><span class="owner-pill" style="color:${owner.dark}">${esc(owner.name)}</span><span>·</span><span>${terrainName[p.terrain]}</span></div><p class="territory-description">${p.terrain==='mountain'?'山势险峻，易守难攻。':p.terrain==='jungle'?'丛林密布，补给与行军更为困难。':p.terrain==='hill'?'丘陵起伏，守军略占地利。':'交通便利，适合发展与集结。'}</p><div class="territory-metrics"><div class="metric"><span>驻守兵力</span><strong>${p.army}<small>人</small></strong></div><div class="metric"><span>回合收入</span><strong>+${p.tax+p.level}<small>国库</small></strong></div><div class="metric"><span>经济等级</span><strong>${p.level/2+1}<small>级</small></strong></div><div class="metric"><span>地形</span><strong style="font-size:15px">${terrainName[p.terrain]}</strong></div></div>${controls}`;
    box.querySelector('#recruit-btn')?.addEventListener('click',recruit);
    box.querySelector('#develop-btn')?.addEventListener('click',develop);
    box.querySelectorAll('[data-neighbor]').forEach(btn=>btn.onclick=()=>selectProvince(btn.dataset.neighbor));
    box.querySelector('#troop-input')?.addEventListener('input',e=>{state.troops=Number(e.target.value);$('troop-count').textContent=`${state.troops} 名`;});
    box.querySelector('#move-btn')?.addEventListener('click',moveOrAttack);
  }

  function selectProvince(id){
    const p=province(id), player=state.game.player;
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
    const amount=Math.min(a.army-1,Math.max(1,state.troops));a.army-=amount;
    if(b.owner===g.player){b.army+=amount;log(`${amount} 名士兵从${a.name}行军至${b.name}。`);toast(`部队已抵达${b.name}`);}
    else{const result=combat(a,b,amount);if(result.win){log(`${a.name}出兵攻占${b.name}，${result.survivors} 名士兵驻守。`);toast(`攻占${b.name}！`);}else{log(`${a.name}进攻${b.name}失利，敌军仍有 ${b.army} 名守军。`);toast(`进攻失利，${b.name}仍由守军控制`);}}
    state.source=state.target=null;state.selected=b.id;checkVictory();save();render();
  }
  function aiTurn(id){
    const g=state.game, own=owns(id);if(!own.length)return;
    const borders=own.map(p=>({p,enemies:adjacents(p).filter(q=>q.owner!==id)})).filter(x=>x.enemies.length);
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
    g.turn++;log(`${s.year+g.turn-1} 年，新一回合开始。${s.factions[g.player].name}收入 +${income(g.player)}。`);
    checkVictory();save();render();toast(`第 ${g.turn} 回合 · 国库收入 +${income(g.player)}`);
  }
  function checkVictory(){
    const g=state.game;if(g.ended)return;
    const playerLands=owns(g.player).length;
    if(playerLands===0){g.ended=true;log('我方失去最后一块领土，战役结束。');toast('战役结束：我方领土尽失');}
    else if(g.provinces.every(p=>p.owner===g.player||p.owner==='neutral')){g.ended=true;log('所有敌对势力已被击败，战区统一！');toast('胜利！你统一了战区');}
  }

  function setView(){const v=state.view;$('map').setAttribute('viewBox',`${v.x} ${v.y} ${v.w} ${v.h}`);}
  function zoom(factor){const v=state.view,nw=Math.max(340,Math.min(1200,v.w*factor)),nh=nw*760/1200;v.x=Math.max(0,Math.min(1200-nw,v.x+(v.w-nw)/2));v.y=Math.max(0,Math.min(760-nh,v.y+(v.h-nh)/2));v.w=nw;v.h=nh;setView();}
  function initMapControls(){
    const map=$('map');let dragging=null;
    map.addEventListener('wheel',e=>{if(!state.game)return;e.preventDefault();zoom(e.deltaY<0?.88:1.12);},{passive:false});
    map.addEventListener('pointerdown',e=>{if(!state.game||e.target.classList.contains('province-shape'))return;dragging={x:e.clientX,y:e.clientY,view:{...state.view}};map.setPointerCapture(e.pointerId);map.classList.add('panning');});
    map.addEventListener('pointermove',e=>{if(!dragging)return;const bounds=map.getBoundingClientRect(),v=state.view;v.x=Math.max(0,Math.min(1200-v.w,dragging.view.x-(e.clientX-dragging.x)*v.w/bounds.width));v.y=Math.max(0,Math.min(760-v.h,dragging.view.y-(e.clientY-dragging.y)*v.h/bounds.height));setView();});
    const stop=()=>{dragging=null;map.classList.remove('panning');};map.addEventListener('pointerup',stop);map.addEventListener('pointercancel',stop);
    $('zoom-in').onclick=()=>zoom(.8);$('zoom-out').onclick=()=>zoom(1.25);$('zoom-reset').onclick=()=>{state.view={x:0,y:0,w:1200,h:760};setView();};
  }
  function boot(){
    renderSetup();initMapControls();
    $('start-btn').onclick=startGame;
    $('end-turn-btn').onclick=endTurn;
    $('new-game-btn').onclick=()=>{state.setupScenario=state.game?.scenario||'three';state.setupFaction=state.game?.player||'wei';renderSetup();$('resume-btn').classList.toggle('hidden',!state.game);$('setup-overlay').classList.remove('hidden');};
    $('resume-btn').onclick=()=>$('setup-overlay').classList.add('hidden');
    $('help-btn').onclick=()=>$('help-overlay').classList.remove('hidden');
    $('close-help').onclick=$('help-done').onclick=()=>$('help-overlay').classList.add('hidden');
    $('help-overlay').addEventListener('click',e=>{if(e.target===$('help-overlay'))$('help-overlay').classList.add('hidden');});
    try{const saved=JSON.parse(localStorage.getItem(SAVE_KEY));if(saved&&scenarios[saved.scenario]&&Array.isArray(saved.provinces)){
      state.game=saved;state.setupScenario=saved.scenario;state.setupFaction=saved.player;renderSetup();$('resume-btn').classList.remove('hidden');render();$('setup-overlay').classList.add('hidden');toast('已恢复上次战役');
    }}catch(err){console.warn('存档读取失败',err);}
  }
  boot();
})();
