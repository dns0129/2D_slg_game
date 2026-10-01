"""Build reproducible, date-specific vector maps. Runtime needs no GIS libraries.
See maps/SOURCES.md for historical precision and licences.
PYTHONPATH=/private/tmp/shanhe-gis-deps python3 scripts/build_atlas.py
"""
from pathlib import Path
import io,json,math,zipfile,csv,re,hashlib
import numpy as np, shapefile
from shapely.geometry import shape,box,Point,Polygon,MultiPoint,LineString,mapping
from shapely.ops import transform,unary_union,voronoi_diagram,nearest_points
from shapely import make_valid
from shapely.strtree import STRtree
from pyproj import Transformer
from scipy.ndimage import map_coordinates,gaussian_filter
from PIL import Image
import rasterio.features
from rasterio.transform import from_bounds
from matplotlib.colors import LightSource

ROOT=Path(__file__).resolve().parents[1]; OLD=ROOT/'previews/real-map-v2/source'; SRC=ROOT/'previews/historical-atlas-v3/source'; OUT=ROOT/'maps';OUT.mkdir(exist_ok=True)
T=Transformer.from_crs(4326,'+proj=laea +lat_0=30 +lon_0=105 +datum=WGS84 +units=m +no_defs',always_xy=True)
INV=Transformer.from_crs(T.target_crs,4326,always_xy=True)
# 1 map unit = 10 km in the projected plane; both axes use the same scale.
def project(g):return make_valid(transform(T.transform,g))
def screen(x,y,z=None):return np.asarray(x)/10000+1000,700-np.asarray(y)/10000
def onscreen(g):return transform(screen,g)
def xy(lon,lat):return [round(v,3) for v in screen(*T.transform(lon,lat))]
def unzip(name,encoding='utf-8'):
 z=zipfile.ZipFile(name); f=lambda e:io.BytesIO(z.read(next(n for n in z.namelist() if n.endswith(e))))
 r=shapefile.Reader(shp=f('.shp'),shx=f('.shx'),dbf=f('.dbf'),encoding=encoding)
 return [(a.record.as_dict(),make_valid(shape(a.shape.__geo_interface__))) for a in r.iterShapeRecords()]
def load(name):return [(f['properties'],make_valid(shape(f['geometry']))) for f in json.loads((SRC/name).read_text())['features']]
def parts(g,poly=False):
 if g.is_empty:return []
 if g.geom_type in ('Polygon','LineString','LinearRing'):return [g] if not poly or g.geom_type=='Polygon' else []
 return [p for sub in getattr(g,'geoms',[]) for p in parts(sub,poly)]
def path(g,tol=0):
 if tol:g=g.simplify(tol,preserve_topology=True)
 g=onscreen(g);out=[]
 for p in parts(g):
  rings=[p.exterior,*p.interiors] if p.geom_type=='Polygon' else [p]
  for ring in rings:
   c=list(ring.coords)
   out.append('M'+'L'.join(f'{x:.3f},{y:.3f}' for x,y in c)+('Z' if p.geom_type=='Polygon' else ''))
 return ''.join(out)
def frame(w,s,e,n):
 lons=np.r_[np.linspace(w,e,70),np.linspace(w,e,70),np.full(70,w),np.full(70,e)];lats=np.r_[np.full(70,s),np.full(70,n),np.linspace(s,n,70),np.linspace(s,n,70)]
 x,y=T.transform(lons,lats);a,b=screen(min(x),max(y));c,d=screen(max(x),min(y));return [round(a,3),round(b,3),round(c-a,3),round(d-b,3)]
WINDOW=box(25,-13,180,79)
landgeo=unary_union([g.intersection(WINDOW) for _,g in unzip(OLD/'ne-land.zip')+unzip(OLD/'ne-minor-islands.zip') if g.intersects(WINDOW)])
land=project(landgeo)
land_gap_tolerance=land.buffer(200)
coastal_band=land.boundary.buffer(2000)

def labelpos(g):
 p=g.representative_point();return [round(v,3) for v in screen(p.x,p.y)]
def bounds(g):
 a,b,c,d=g.bounds;x,y=screen(a,d);return [round(x,3),round(y,3),round((c-a)/10000,3),round((d-b)/10000,3)]
def record(id,name,parent,owner,g,kind='行政区',basis='',source='empire',note='',validFrom=None,validTo=None,search=None):
 if g.is_empty:return None
 g=make_valid(g);g=unary_union(parts(g,True));p=labelpos(g)
 return {'id':id,'name':name,'parent':parent,'owner':owner,'kind':kind,'basis':basis,'source':source,'note':note,'validFrom':validFrom,'validTo':validTo,'search':search or [],'x':p[0],'y':p[1],'bounds':bounds(g),'path':path(g,500),'overviewPath':path(g,2000),'terrain':'plain','army':14 if owner!='neutral' else 6,'tax':5,'level':0,'_geo':g}
def macro(units):
 groups={}
 for p in units:groups.setdefault(p['parent'],[]).append(p)
 out=[]
 for key,ps in groups.items():
  g=unary_union([p['_geo'] for p in ps]);out.append({'id':key,'name':key,'children':[p['id'] for p in ps],'x':labelpos(g)[0],'y':labelpos(g)[1],'bounds':bounds(g),'path':path(g,500),'overviewPath':path(g,2000)})
 return out

def adjacency(units,sea_pairs=()):
 gs=[p['_geo'] for p in units];tree=STRtree(gs);links={p['id']:set() for p in units}
 # Georeferencing of separate sheets leaves small gaps. Up to 5 km tolerance,
 # minimum shared frontage 800 m; no distance-only links across seas.
 for i,g in enumerate(gs):
  for j in tree.query(g.buffer(5000)):
   if j<=i:continue
   h=gs[j]
   if g.distance(h)<=5000 and g.boundary.intersection(h.buffer(5000)).length>=800 and (g.distance(h)<50 or land_gap_tolerance.covers(LineString(nearest_points(g,h)))):
    links[units[i]['id']].add(units[j]['id']);links[units[j]['id']].add(units[i]['id'])
 validids=set(links)
 for a,b in sea_pairs:
  if a in validids and b in validids:links[a].add(b);links[b].add(a)
 return {k:sorted(v) for k,v in links.items()}

def zh_table(name):return {a['key']:a.get('zh') or a.get('en') or a['key'] for a in csv.DictReader((SRC/(name+'.csv')).open())}
trans=str.maketrans('臺灣縣廳區廣東陽陰寧遼濱薩爾滿國蘭興龍綏熱貴雲陝慶關屬郡','台湾县厅区广东阳阴宁辽滨萨尔满国兰兴龙绥热贵云陕庆关属郡')
def simp(v):return str(v or '未命名地域').translate(trans)

# THREE KINGDOMS. Digitised border network from Esiymbro's historical atlas.
# A few unclosed / ambiguous polygons are explicitly joint commandery domains.
# The date audit disallows administrations established after the scenario date.
han=load('han-digitized.geojson')
HAN_NAMES='常山 赵 钜鹿 中山 博陵 安平 乐陵 平原 济南 上谷 涿 代 - 渔阳 广阳 右北平 辽西 辽东属国 辽东与玄菟 乐浪 带方 东郡 甘陵 河间 渤海 章武 乐安 齐 东莱 北海 城阳 东莞 琅邪与利城 泰山 济北 东平 山阳 任城 济阴 陈留 沛 鲁 梁 谯 陈 汝南 弋阳 上庸 房陵 南乡与襄阳 南郡 江夏 长沙 武陵 宜都 零陵 桂阳 南海 苍梧 合浦 郁林 交趾 九真 日南 南阳 章陵 西城 淮南 庐江 丹阳 广陵 临川 鄱阳 豫章 会稽 吴 庐陵 新都 蕲春 颍川 东海 彭城 下邳 河东 河南 京兆与弘农 雁门 太原 新兴 西河 乐平 上党 魏 河内 右扶风 安定 汉兴 北地与左冯翊 汉阳 陇西 武都 武威 西平与西郡 金城 张掖 敦煌 酒泉与西海 - 张掖属国 汉中 阴平与梓潼 宕渠 巴西 广汉 汶山 蜀与蜀属国 犍为 越嶲 朱提 益州 永昌 牂柯 江阳 巴郡 固陵 巴东属国'.split()
assert len(HAN_NAMES)==126
HAN_GROUPS={}
for province,names in {
 '幽州':'上谷 涿 代 渔阳 广阳 右北平 辽西 辽东属国 辽东与玄菟 乐浪 带方',
 '冀州':'常山 赵 钜鹿 中山 博陵 安平 平原 甘陵 河间 渤海 章武 魏',
 '青州':'乐陵 济南 乐安 齐 东莱 北海 城阳',
 '并州':'雁门 太原 新兴 西河 乐平 上党',
 '兖州':'东郡 济北 东平 山阳 任城 济阴 陈留 泰山',
 '豫州':'沛 梁 谯 陈 汝南 弋阳 颍川 鲁',
 '徐州':'东莞 琅邪与利城 广陵 东海 彭城 下邳',
 '司隶':'河东 河南 京兆与弘农 河内 右扶风 北地与左冯翊',
 '雍州':'安定 汉兴 汉阳 陇西 武都',
 '凉州':'武威 西平与西郡 金城 张掖 敦煌 酒泉与西海 张掖属国',
 '扬州':'淮南 庐江 丹阳 临川 鄱阳 豫章 会稽 吴 庐陵 新都 蕲春',
 '荆州':'上庸 房陵 南乡与襄阳 南郡 江夏 长沙 武陵 宜都 零陵 桂阳 南阳 章陵 西城 固陵',
 '益州':'汉中 阴平与梓潼 宕渠 巴西 广汉 汶山 蜀与蜀属国 犍为 越嶲 朱提 益州 永昌 牂柯 江阳 巴郡 巴东属国',
 '交州':'南海 苍梧 合浦 郁林 交趾 九真 日南'}.items():
 for name in names.split():HAN_GROUPS[name]=province
three=[]
shu_names=set('汉中 阴平与梓潼 巴西 广汉 汶山 蜀与蜀属国 犍为 越嶲 朱提 益州 永昌 牂柯 江阳 巴郡 巴东属国 宕渠'.split())
wei_jing=set('上庸 房陵 西城 南阳 章陵 南乡与襄阳'.split())
for props,geo in han:
 i=props['i']
 if i>=126 or HAN_NAMES[i]=='-':continue
 name=HAN_NAMES[i];parent=HAN_GROUPS[name];owner='wei'
 if name in shu_names:owner='shu'
 elif parent in ('扬州','交州') or parent=='荆州' and name not in wei_jing:owner='wu'
 if name in ('淮南','广陵'):owner='wei'
 if name in ('辽东与玄菟','乐浪','带方'):owner='liaodong'
 if name in ('交趾','九真','日南'):owner='shi'
 note='219 年州郡复原图配准；222 年局部沿革调整。界线为历史复原，不能作为精确县界。'
 if '与' in name:note+='底图边界未闭合或治所标注有歧义，暂合为联合郡域；不伪造细界。'
 if name=='淮南':note+='魏文帝时期九江郡改称淮南郡。'
 g=project(geo).intersection(land)
 # 222 固陵废：将吴侧郡域并入宜都，蜀侧保留巴东的游戏域。
 three.append(record(f'han-{i}',name if name.endswith(('郡','属国')) else name+'郡',parent,owner,g,'联合郡域' if '与' in name else '郡 / 国','219 底本 → 222 复原','han',note))
# Merge the three eastern commanderies into Wei's Xincheng domain, established 220.
mergeids=['han-47','han-48','han-66'];ps=[p for p in three if p['id'] in mergeids]
three=[p for p in three if p['id'] not in mergeids]
three.append(record('han-xincheng','新城郡','荆州','wei',unary_union([p['_geo'] for p in ps]),'郡','220 年设郡','han','合并上庸、房陵、西城郡域；细界依据 219 底图复原。',220))
# Jingzhao belongs to Yong after 220, Hongnong to Sili; the joint domain is not
# labelled as one verified administrative unit. Keep parent "关中郡域" explicit.
for p in three:
 if p['id']=='han-85':p['parent']='关中郡域';p['note']+='京兆属雍州、弘农属司隶；此联合域不等同于一州。'
 if p['id']=='han-94':p['parent']='雍州'
 if p['id']=='han-97':p['parent']='雍州'
# Guling abolished after Yiling; retain its footprint in Yidu's reconstruction.
a=next(p for p in three if p['id']=='han-54');b=next(p for p in three if p['id']=='han-124');three.remove(a);three.remove(b)
three.append(record('han-yidu','宜都郡','荆州','wu',unary_union([a['_geo'],b['_geo']]),'郡','222 年夷陵战后复原','han','合入底图固陵郡域；具体战后界线尚待精校。'))
# Dangqu was short lived; use Baxi domain instead of presenting a 222 Dangqu.
a=next(p for p in three if p['id']=='han-111');b=next(p for p in three if p['id']=='han-112');three.remove(a);three.remove(b)
three.append(record('han-baxi','巴西郡','益州','shu',unary_union([a['_geo'],b['_geo']]),'郡','222 复原','han','底图宕渠郡域并回巴西；界线为复原。'))

for p in three:
 if p['id']=='han-125':
  p['name']='涪陵郡';p['basis']='221 年由巴东属国改置';p['validFrom']=221;p['source']='fuling';p['note']='蜀汉章武元年改巴东属国为涪陵郡；界线沿用 219 底本的属国域复原。'
 if p['id']=='han-98':
  p['name']='天水郡';p['search']=['汉阳','Hanyang'];p['basis']='220 年改名说 / 219 界线底本';p['source']='tianshui';p['note']='地方志对汉阳改天水的年份有黄初元年与魏明帝时两说，本版采用黄初元年说，名称年代仍标为有异记。'
 if p['id']=='han-25':p['note']+='章武设郡年代在地方志与后世沿革中有异记；该细界尚待进一步核对。'

# WORLD WAR II: fixed to 6 December 1941, before the Pacific offensives.
sub=load('sub-units.geojson');landparts=dict((p['atom'],g) for p,g in load('land.geojson'));asia=[]
provzh={'Xinjiang':'新疆省','Tibet':'西藏地方','Xikang':'西康省','Yunnan':'云南省','Gansu':'甘肃省','Ningxia':'宁夏省','Qinghai':'青海省','Shaanxi':'陕西省','Sichuan':'四川省','Guizhou':'贵州省','Guangxi':'广西省','Hubei':'湖北省','Henan':'河南省','Anhui':'安徽省','Jiangxi':'江西省','Hunan':'湖南省','Shanxi':'山西省','Heilongjiang':'黑龙江省','Jilin':'吉林省','Liaoning':'辽宁省','Rehe':'热河省','Chahar':'察哈尔省','Suiyuan':'绥远省','Jiangsu':'江苏省','Hebei':'河北省','Zhejiang':'浙江省','Guangdong':'广东省','Fujian':'福建省','Shandong':'山东省'}
# Smaller gameplay areas follow real county geometry inside historical province
# exteriors. These are STRATEGIC partitions, never claimed as 1941 county bounds.
counties=[make_valid(shape(f['geometry'])) for f in json.loads((OLD/'china-counties.geojson').read_text())['features']]
cc=np.array([[g.representative_point().x,g.representative_point().y] for g in counties]);cctree=STRtree(counties)
shanghai_geo=next(make_valid(shape(f['geometry'])) for f in json.loads((OLD/'china-counties.geojson').read_text())['features'] if f['properties'].get('shapeName')=='Shanghaishi')
# Shanghai is a historic municipality; this provisional urban gameplay footprint
# is declared a strategic approximation and is removed from Jiangsu's partitions.
asia.append(record('cn-shanghai-city','上海市域分区','上海市','japan',project(shanghai_geo).intersection(land),'战略分区','1927 设市 / 市域边界待精校','republican','上海市建制存在于本剧本。当前可玩市域采用公开城市地理范围复原，尚非逐界核实的 1941 市界。',1927,search=['Shanghai','上海']))
municipal={}
# Shanghai municipal boundary from historical GIS: use the 1930s footprint, not
# today's huge municipality. Original source has separate leased concessions.
for atom,name in [('hongkong','香港'),('macau','澳门'),('guangzhouwan','广州湾租借地'),('kwantung','关东州')]:
 if atom in landparts:municipal[atom]=(name,project(landparts[atom]).intersection(land))
for props,geo in load('republican-china-provinces-v5.geojson'):
 name=props['name'].strip();base=project(geo).intersection(land)
 if base.is_empty:continue
 parent=provzh[name];k=4 if name not in ('Xinjiang','Tibet','Qinghai','Xikang') else 6
 inds=[i for i in cctree.query(geo) if geo.covers(Point(*cc[i]))]
 local=[project(counties[i]).intersection(base) for i in inds];local=[g for g in local if g.area>1e5]
 points=np.array([[g.representative_point().x,g.representative_point().y] for g in local])
 if name=='Zhejiang':seeds=np.array([T.transform(*a) for a in [(120.2,30.6),(121.35,29.5),(119.4,29),(120.1,27.9)]]);labels=['浙北分区','浙东分区','浙中西分区','浙南分区']
 else:
  candidates=[base.representative_point()] + [Point(base.bounds[0]+(base.bounds[2]-base.bounds[0])*a,base.bounds[1]+(base.bounds[3]-base.bounds[1])*b) for a,b in [(.2,.2),(.8,.2),(.2,.8),(.8,.8),(.5,.5),(.4,.6)]]
  pool=points if len(points)>=k else np.array([[p.x,p.y] for p in candidates])
  seeds=[pool[np.argmin(np.linalg.norm(pool-pool.mean(axis=0),axis=1))]]
  for _ in range(k-1):seeds.append(pool[np.argmax(np.min(np.linalg.norm(pool[:,None]-np.array(seeds)[None],axis=2),axis=1))])
  seeds=np.array(seeds)
  for _ in range(12):
   assignments=np.argmin(np.linalg.norm(points[:,None]-seeds[None],axis=2),axis=1) if len(points) else []
   seeds=np.array([points[np.array(assignments)==j].mean(axis=0) if any(np.array(assignments)==j) else seeds[j] for j in range(k)])
  labels=[parent.replace('省','').replace('地方','')+f'·分区{j+1}' for j in range(k)]
 assignment=np.argmin(np.linalg.norm(points[:,None]-seeds[None],axis=2),axis=1) if len(points) else []
 regs=[];claimed=Polygon()
 for j in range(k):
  g=unary_union([g for g,a in zip(local,assignment) if a==j]).difference(claimed);regs.append(g);claimed=unary_union([claimed,g])
 remainder=base.difference(claimed);cells=list(voronoi_diagram(MultiPoint(seeds),envelope=base.envelope.buffer(1e6)).geoms)
 for j,seed in enumerate(seeds):regs[j]=make_valid(unary_union([regs[j],next(c for c in cells if c.covers(Point(seed))).intersection(remainder)]))
 for j,g in enumerate(regs):
  owner='china';c=g.representative_point();lon,lat=INV.transform(c.x,c.y)
  if name in ('Heilongjiang','Jilin','Liaoning','Rehe'):owner='manchu'
  elif name in ('Hebei','Shandong') or name in ('Jiangsu','Zhejiang') and (lat>30.5 or name=='Jiangsu') or name=='Shanxi' and lon>112.1 or name=='Chahar' and lon>113.5:owner='japan'
  r=record(f'cn-{name.lower()}-{j+1}',labels[j],parent,owner,g,'战略分区','1928–45 省界 / 现代地理分区','republican','省界依据民国历史地图。内部边界是沿真实地理划分的游戏战略分区，尚未替换成已核实的 1941 督察区或县界。初始控制权为战区抽象，不能表示日军控制全境。',search=[name,parent])
  if name in ('Tibet','Qinghai','Xikang','Yunnan','Sichuan','Guizhou'):r['terrain']='mountain'
  elif name in ('Zhejiang','Fujian','Guangxi','Guangdong'):r['terrain']='hill'
  asia.append(r)
# Japanese prefectures / Korean thirteen do (no future Tokyo-to or Jeju-do).
for atom,table,parent,owner,kind in [('japan','japan','日本内地','japan','府 / 县 / 厅'),('korea','korea','朝鲜总督府','japan','道'),('philippines','philippines','菲律宾自由邦','us','省')]:
 names=zh_table(table);by={p['name']:g for p,g in sub if p['atom']==atom}
 if atom=='korea' and 'Saishu' in by:
  # Jeju became a province only in 1946; in 1941 it belongs to South Jeolla.
  key=next((k for k in by if k=='Zenranan'),None)
  if key:by[key]=unary_union([by[key],by.pop('Saishu')])
 for key,geo in by.items():
  g=project(geo).intersection(land);name=simp(names.get(key,key))
  asia.append(record(f'{atom}-{key.lower()}',name,parent,owner,g,kind,'1941（历史名称；边界复原）','empire','采用历史府县、道或省的结构；部分外缘使用现代地理资料配准。',search=[key]))
# Okinawa: contemporary prefecture, not 24 independent island administrations.
ryu=[project(g).intersection(land) for p,g in sub if p['atom']=='ryukyu'];asia.append(record('japan-okinawa','冲绳县','日本内地','japan',unary_union(ryu),'县','1941','empire','岛岸线来自公开地理资料；并为当时冲绳县。',search=['Okinawa']))
# Taiwan: aggregate the 1926 district reference into five prefectures / three
# subprefectures. Do not present outdated 1926 town splits as 1941 verified units.
twrows={a['key']:a for a in csv.DictReader((SRC/'taiwan.csv').open())};tw={}
twnames={'Taihoku-shū':'台北州','Shinchiku-shū':'新竹州','Taichū-shū':'台中州','Tainan-shū':'台南州','Takao-shū':'高雄州','Karenkō-chō':'花莲港厅','Taitō-chō':'台东厅','Hōko-chō':'澎湖厅'}
# Mainland highlands were classified as banchi in the 1926 source. Preserve
# that historical district type rather than invent a ninth prefecture.
for p,geo in sub:
 if p['atom']!='taiwan':continue
 key=p['name'];row=twrows.get(key,{})
 if key=='TwBanchi':parent='蕃地（州厅辖山地合域）'
 elif key in ('TwKarenko','TwTaito','TwHoko'):parent=simp(row.get('zh') or key)
 else:
  m=re.search(r'In ([A-Za-zāūō-]+)',row.get('short',''));parent=twnames.get(m.group(1),m.group(1)) if m else simp(row.get('zh') or key)
 tw.setdefault(parent,[]).append(project(geo).intersection(land))
for key,gs in tw.items():asia.append(record('tw-'+str(len(asia)),key,'台湾总督府','japan',unary_union(gs),'州 / 厅 / 山地域','1926 州厅底本 / 1941 结构','empire','1926 郡市边界合成州厅；1933、1940 新设市的细界不作为 1941 县界展示。蕃地为底本山地域合域。'))
# Burma: real 1931 census district map, clearly dated rather than silently 1941.
burnames=zh_table('burma');burparents={'Sagaing':'实皆','Mandalay':'曼德勒','Magwe':'马圭','Pegu':'勃固','Irrawaddy':'伊洛瓦底','Tenasserim':'丹那沙林','Arakan':'阿拉干','Shan States':'掸邦','Karenni':'克伦尼'}
for p,geo in load('burma-1931.geojson'):
 name=simp(burnames.get(p['name'],p['name'])) if p['name'] else '未设治地域 · '+str(p['fid']);par=burparents.get(p['state'],p['state']) or '边疆辖域'
 asia.append(record('burma-'+str(p['fid']),name,'缅甸 · '+par,'uk',project(geo).intersection(land),'县 / 土邦','1931 人口普查图底本','empire','1941 剧本使用 1931 历史县、邦底本；尚未逐条核完 1931–1941 的所有小调整。'))
# Netherlands Indies: use actual 1941 residencies, no 1942 military districts.
deinames=zh_table('dei');deiparents={'Midden-Java':'中爪哇','West-Java':'西爪哇','Oost-Java':'东爪哇','Sumatra':'苏门答腊','Borneo':'婆罗洲','Groote Oost':'大东部'}
for p,geo in load('dei-1941.geojson'):
 name=simp(deinames.get(p['name'],p['name']));par='荷属东印度 · '+deiparents.get(p.get('gouvernement'),p.get('gouvernement') or '外岛')
 asia.append(record('dei-'+str(p['fid']),name,par,'dutch',project(geo).intersection(land),'驻扎区','1941 行政区','empire','1941 residentie 行政区；不使用资料中另附的 1942 日军军管字段。'))
# Indochina protectorates and provinces, subtract 1941 ceded land.
ceded=unary_union([g for _,g in load('indochina-1941-ceded.geojson')]);indonames=zh_table('indochina');prot={'Tonkin':'东京保护地','Annam':'安南保护地','Cochinchina':'交趾支那殖民地','Laos':'老挝保护地','Cambodia':'柬埔寨保护地'}
for i,(p,geo) in enumerate(load('indochina-admin.geojson')):
 g=project(geo.difference(ceded)).intersection(land)
 if g.area<5e6:continue
 name=simp(indonames.get(p['name_french'],indonames.get(p['name'],p['name_french'])))
 asia.append(record('indo-'+str(i),name,'法属印度支那 · '+prot.get(p['protectorate'],p['protectorate']),'france',g,'省','1941 割地后 / 1945 OSS 图底本','empire','行政仍属法属印度支那；日军驻扎与行政主权分开。县省底本晚于剧本 4 年，微调未逐项核实。'))
for i,(p,geo) in enumerate(load('indochina-1941-ceded.geojson')):asia.append(record('siam-ceded-'+str(i),'泰国新领地 · '+('柬埔寨' if p['name']=='Cambodia' else '老挝'),'泰国','thailand',project(geo).intersection(land),'1941 割让区','1941-05 条约','empire','1941 年法泰条约割让部分；不等同于完整的泰国省界。',1941))
princely_names={'Hyderabad':'海得拉巴土邦','Kashmir & Jammu':'查谟与克什米尔土邦','Mysore':'迈索尔土邦','Manipur':'曼尼普尔土邦','Tripura':'特里普拉土邦','Bastar':'巴斯塔尔土邦','Benares':'贝拿勒斯土邦','Cooch Behar':'库奇比哈尔土邦','Khairpur':'凯尔布尔土邦','Pudukkottai':'普杜科泰土邦','Rampur':'兰普尔土邦','Tehri Garhwal':'特赫里加瓦尔土邦','Travancore & Cochin':'特拉凡哥尔与科钦土邦合域','Rajputana, Central India & the Gujarat States':'拉杰普塔纳、中印度及古吉拉特土邦合域'}
for i,(p,geo) in enumerate((p,g) for p,g in sub if p['atom']=='princely'):
 key=p['name']
 if not key:continue
 name=princely_names.get(key,key)
 asia.append(record('india-state-'+str(i),name,'英属印度 · 土邦与代理区','uk',project(geo).intersection(land),'土邦 / 土邦合域','1931 帝国地名志底本','empire','土邦保持地方统治，英国行使宗主权；本版以英国阵营指挥。部分小土邦按原底图合域，未假称单一邦。'))
# The northern Malay states were ceded to Thailand in 1943, not 1941. Dindings
# reverted to Perak in 1935. Keep Singapore, Penang and Malacca settlements.
malay={};malay_names={'Singapore':'新加坡','Selangor':'雪兰莪','Johor':'柔佛','Malacca':'马六甲','NegeriSembilan':'森美兰','Pahang':'彭亨','Perak':'霹雳','Penang':'槟城','Kelantan':'吉兰丹','Terengganu':'登嘉楼','Kedah':'吉打','Perlis':'玻璃市'}
for p,geo in sub:
 if p['atom'] not in ('malaya','malaya_thai'):continue
 key='Perak' if p['name']=='Dindings' else p['name'];malay.setdefault(key,[]).append(project(geo).intersection(land))
for key,gs in malay.items():asia.append(record('malaya-'+key.lower(),malay_names.get(key,key),'英属马来亚','uk',unary_union(gs),'州 / 海峡殖民地辖区','1941（几何为配准复原）','empire','1941 北马来四州尚属英国保护体系；天定自 1935 年归霹雳，不列为海峡殖民地独立辖区。'))

# Historic outlines where verified subunits are not available; no fabricated
# modern India/Pakistan provinces or modern Thai changwat in this date snapshot.
extras=[('india','英属印度','uk'),('siam','泰国本部','thailand'),('northborneo','英属北婆罗洲','uk'),('sarawak','砂拉越','uk'),('brunei','文莱','uk'),('ceylon','锡兰','uk'),('karafuto','桦太厅','japan'),('chishima','千岛群岛','japan'),('andaman','安达曼与尼科巴群岛','uk'),('timor_pt','葡属帝汶','neutral'),('mongolia','蒙古人民共和国','neutral'),('tuva','图瓦人民共和国','neutral'),('nepal','尼泊尔','neutral'),('bhutan','不丹','neutral'),('sikkim','锡金','neutral')]
for atom,name,owner in extras:
 if atom not in landparts:continue
 geo=landparts[atom]
 if atom=='india':geo=load('india-1931.geojson')[0][1].difference(unary_union([g for p,g in sub if p['atom']=='princely' and p['name']]))
 if atom=='siam':geo=geo.difference(ceded)
 asia.append(record('region-'+atom,name,name,owner,project(geo).intersection(land),'国家 / 殖民领地','1931–1941 历史外缘底本','empire','暂以可追溯的历史外缘展示；未编造省内行政界。'))
for atom,(name,g) in municipal.items():
 owner={'hongkong':'uk','macau':'neutral','guangzhouwan':'france','kwantung':'japan'}[atom]
 asia.append(record('region-'+atom,name,name,owner,g,'租借地 / 殖民地','1941','empire','起始日期为 1941 年 12 月 6 日；香港尚未被日军占领。'))
asia=[p for p in asia if p and not p['_geo'].is_empty and p['_geo'].area>1e5]
# Enforce a disjoint game partition while preserving each historical parent
# footprint. Small colony overlaps are removed from the province they sit in.
occupied=Polygon()
priority=sorted(asia,key=lambda p:(0 if p['id']=='cn-shanghai-city' or p['id'].startswith('region-') and p['name'] in [n for n,_ in municipal.values()] else 1,0 if p['id'].startswith('cn-') else 1))
originals=[p['_geo'] for p in priority];ptree=STRtree(originals);claimed=set()
for idx,p in enumerate(priority):
 nearby=[priority[j]['_geo'] for j in ptree.query(p['_geo']) if j in claimed]
 g=unary_union(parts(make_valid(p['_geo'].difference(unary_union(nearby))),True)) if nearby else p['_geo'];p['_geo']=g
 if not g.is_empty:
  p['path']=path(g,500);p['overviewPath']=path(g,2000);p['bounds']=bounds(g);p['x'],p['y']=labelpos(g);claimed.add(idx)
asia=[p for p in priority if not p['_geo'].is_empty and p['_geo'].area>1e5]
occupied=unary_union([p['_geo'] for p in asia]);print('WWII regions assembled:',len(asia),flush=True)

# Outside the playable Asia-Pacific theatre, display period countries as map
# context from CShapes2, never as modern borders in the 1941 layer.
from datetime import date
context=[]
for p,g in unzip(SRC/'cshapes-2.zip','latin1'):
 if not (p['gwsdate']<=date(1941,12,6)<=p['gwedate']):continue
 if p['cntry_name'] not in {'Turkey (Ottoman Empire)','Iran (Persia)','Iraq','Saudi Arabia','Afghanistan','Russia (Soviet Union)','Syria','Lebanon','Yemen (Arab Republic of Yemen)','Oman','Palestine','Jordan','Qatar','United Arab Emirates','Aden','East Aden Protectorate'}:continue
 g=g.intersection(WINDOW)
 if g.is_empty:continue
 g=unary_union(parts(project(g).intersection(land).difference(occupied),True))
 if g.area<1e8:continue
 name={'Palestine':'英属巴勒斯坦','Jordan':'外约旦','Qatar':'卡塔尔','Aden':'亚丁殖民地','East Aden Protectorate':'亚丁保护地','Turkey (Ottoman Empire)':'土耳其','Iran (Persia)':'伊朗','Russia (Soviet Union)':'苏联','Yemen (Arab Republic of Yemen)':'也门','United Arab Emirates':'阿曼停战诸酋长国','Vietnam (Annam/Cochin China/Tonkin)':'法属印度支那','Myanmar (Burma)':'英属缅甸','Sri Lanka (Ceylon)':'锡兰','Turkey':'土耳其','Iran':'伊朗','Iraq':'伊拉克','Saudi Arabia':'沙特阿拉伯','Afghanistan':'阿富汗','Soviet Union':'苏联','Syria':'叙利亚','Lebanon':'黎巴嫩','Mongolia':'蒙古','Yemen':'也门','Oman':'阿曼'}.get(p['cntry_name'],p['cntry_name'])
 if p['cntry_name']=='Russia (Soviet Union)':
  sov=record('ussr-asia','苏联亚洲领土','苏联亚洲领土','soviet',g,'国家领土','1941-12-06 国家外缘','cshapes','亚洲范围内的苏联国家外缘；尚未编造加盟共和国或州的细界。');sov['army']=32;sov['tax']=10;asia.append(sov);continue
 context.append({'name':name,'path':path(g,2000),'bounds':bounds(g),'x':labelpos(g)[0],'y':labelpos(g)[1]})
# Rivers are real line geometry, LOD by cartographic scalerank.
rivers=[]
for p,g in unzip(OLD/'ne-rivers.zip'):
 g=g.intersection(WINDOW)
 if g.is_empty:continue
 rivers.append({'name':p.get('name') or '', 'rank':int(p.get('scalerank') or 0),'path':path(project(g),150)})
lakes=[]
for p,g in unzip(OLD/'ne-lakes.zip'):
 g=g.intersection(WINDOW)
 if not g.is_empty:lakes.append({'rank':int(p.get('scalerank') or 0),'path':path(project(g),150)})
yellow=[path(project(g),100) for _,g in load('yellow-river-1941.geojson')]
# Cities: historical names and fixed locations; never reuse Xian in 222.
three_cities=[('长安',108.86,34.35,3),('洛阳',112.62,34.72,3),('成都',104.06,30.67,3),('武昌',114.88,30.40,3),('建业',118.79,32.05,2),('吴县',120.62,31.30,2),('山阴',120.58,30,2),('襄阳',112.14,32.04,2),('江陵',112.19,30.33,2),('南郑',107.03,33.06,2),('番禺',113.27,23.13,2),('敦煌',94.67,40.14,2),('邺',114.38,36.34,2),('许',113.85,34.03,2),('合肥',117.27,31.86,2),('蓟',116.40,39.90,2),('临湘',112.98,28.19,2),('滇池',102.75,24.98,2),('建安',118.32,27.04,1),('龙编',106.09,21.02,2)]
asia_cities=[('重庆',106.55,29.56,3),('南京',118.79,32.05,3),('上海',121.47,31.23,3),('北平',116.40,39.90,3),('天津',117.20,39.13,2),('西安',108.94,34.26,2),('成都',104.06,30.67,2),('昆明',102.71,25.04,2),('武汉',114.30,30.58,2),('广州',113.27,23.13,2),('杭州',120.16,30.25,2),('宁波',121.55,29.87,2),('金华',119.65,29.08,1),('温州',120.70,28.00,2),('绍兴',120.58,30.00,1),('嘉兴',120.75,30.75,1),('临海',121.13,28.86,1),('丽水',119.92,28.45,1),('衢县',118.88,28.97,1),('哈尔滨',126.64,45.76,2),('新京',125.32,43.82,2),('奉天',123.43,41.80,2),('东京',139.69,35.68,3),('大阪',135.50,34.69,2),('京都',135.77,35.01,2),('札幌',141.35,43.06,2),('福冈',130.40,33.59,2),('京城',126.98,37.57,3),('平壤',125.75,39.03,2),('釜山',129.07,35.18,2),('台北',121.57,25.03,2),('香港',114.16,22.28,2),('西贡',106.70,10.78,2),('河内',105.85,21.03,2),('仰光',96.20,16.87,2),('曼德勒',96.09,21.98,1),('曼谷',100.50,13.75,3),('新加坡',103.82,1.35,3),('马尼拉',120.98,14.60,3),('巴达维亚',106.82,-6.18,3),('泗水',112.75,-7.25,2),('孟买',72.83,18.94,3),('加尔各答',88.36,22.57,3),('德里',77.21,28.61,2),('马德拉斯',80.27,13.08,2),('科伦坡',79.86,6.93,2),('海参崴',131.88,43.12,2),('库伦',106.90,47.92,2)]
def cities(rows):return [{'name':n,'lon':lon,'lat':lat,'x':xy(lon,lat)[0],'y':xy(lon,lat)[1],'importance':imp} for n,lon,lat,imp in rows]
# Shared physical geometry. Ancient river channels beyond the historic source's
# resolution are not asserted as fully reconstructed; shown with a clear note.
physical={'projection':'Lambert Azimuthal Equal Area, centre 105°E 30°N','unitsKm':10,'fullBounds':frame(25,-13,180,79),'land':path(land,200),'rivers':rivers,'lakes':lakes,'yellow1941':yellow,'context':context}

def sea_link(units,citya,cityb,rows):
 by={n:(lon,lat) for n,lon,lat,_ in rows}
 def nearest(city):
  x,y=T.transform(*by[city]);return min(units,key=lambda p:p['_geo'].distance(Point(x,y)))['id']
 return [nearest(citya),nearest(cityb)]
sea_asia=[sea_link(asia,a,b,asia_cities) for a,b in [('福冈','釜山'),('上海','大阪'),('广州','香港'),('香港','马尼拉'),('马尼拉','巴达维亚'),('新加坡','巴达维亚'),('新加坡','马尼拉'),('东京','札幌'),('福冈','台北'),('台北','上海')]]
# Archipelago connectivity: link each land-connected component to its next
# nearest component within the same initial administration / alliance. This
# makes every playable faction's island groups reachable over explicit sea links.
for units,links in [(asia,sea_asia),(three,[])]:
 adj0=adjacency(units,links)
 for owner in sorted(set(p['owner'] for p in units)-{'neutral'}):
  own=[p for p in units if p['owner']==owner];ids={p['id'] for p in own};remaining=set(ids);components=[]
  while remaining:
   start=remaining.pop();part={start};todo=[start]
   while todo:
    for n in adj0[todo.pop()]:
     if n in remaining:remaining.remove(n);part.add(n);todo.append(n)
   components.append(part)
  if len(components)<2:continue
  byid={p['id']:p for p in own};coastal={p['id'] for p in own if p['_geo'].boundary.intersection(coastal_band).length>400};connected=components.pop(0)
  while components:
   candidates=[(byid[a]['_geo'].distance(byid[b]['_geo']),i,a,b) for i,c in enumerate(components) for a in connected & coastal for b in c & coastal]
   if not candidates:break
   distance,i,a,b=min(candidates)
   if units is asia:links.append([a,b])
   # In the landlocked ancient theatre unresolved slivers stay explicitly
   # disconnected rather than inventing a pass across a political boundary.
   connected.update(components.pop(i))

# Fix historical metadata and audit every snapshot before exporting.
report={'projection':physical['projection'],'units_km':10,'scenarios':{},'limitations':['古代界线为配准复原，存在联合郡域；非逐县精校的 222 年定本','中国 1941 省内战略分区不是历史县界','部分亚洲地区使用 1931 或 1945 底本，年份在 inspector 中公开','自然海岸使用现代公开物理地理底图；古代河道未全量复原','初始势力控制是可玩的战区抽象，不是精确占领线']}
scens={}
for key,units,rows,home,links in [('three',three,three_cities,frame(88,17,130,44),[]),('asia',asia,asia_cities,frame(67,-11,147,60),sea_asia)]:
 for p in units:
  assert p['_geo'].is_valid and not p['_geo'].is_empty,p['id']
  assert p['validFrom'] is None or p['validFrom'] <= (222 if key=='three' else 1941),p['id']
  assert p['validTo'] is None or p['validTo'] >= (222 if key=='three' else 1941),p['id']
  assert all(np.isfinite(p['bounds']))
 # Dates: no future Zhejiang / Dongyang / Linhai / Wuxing / Jianning in 222;
 # no modern Tokyo-to, Korea split, modern Indonesia republic, or Myanmar.
 if key=='three':assert not any(any(n in p['name'] for n in ['浙江','东阳','临海','吴兴','建宁','广州']) for p in units)
 adj=adjacency(units,links);assert all(a in adj[b] for a,bs in adj.items() for b in bs)
 ms=macro(units);coverage=max([unary_union([p['_geo'] for p in units if p['parent']==m['id']]).area for m in ms])
 report['scenarios'][key]={'units':len(units),'macro_regions':len(ms),'valid':True,'symmetric_adjacency':True,'sea_routes':links,'joint_or_strategy_units':sum(p['kind'] in ('战略分区','联合郡域') for p in units)}
 scens[key]={'date':'0222-12-01' if key=='three' else '1941-12-06','mapVersion':'3.0.0','homeBounds':home,'units':[{k:v for k,v in p.items() if k!='_geo'} for p in units],'regions':ms,'adjacency':adj,'seaRoutes':links,'cities':cities(rows),'historicalNote':report['limitations'][0] if key=='three' else '1941-12-06 起始。省内战略分区及跨年历史底本均在地块情报中标明。'}
 atlas={'version':3,'physical':physical,'scenarios':scens}
(OUT/'atlas.js').write_text('/* Generated by scripts/build_atlas.py; licences and sources: maps/SOURCES.md */\nwindow.SHANHE_ATLAS = '+json.dumps(atlas,ensure_ascii=False,separators=(',',':'))+';\n')
(OUT/'checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report['scenarios'],ensure_ascii=False),flush=True)

# Relief rasters share exactly the vector projection. Lazy higher-resolution
# overlays activate when zoomed: Asian DEM z5, east Asia z8, Zhejiang z10.
def relief(geo_box,z,width,filename):
 fb=frame(*geo_box);x0=(fb[0]-1000)*10000;y1=(700-fb[1])*10000;x1=x0+fb[2]*10000;y0=y1-fb[3]*10000;height=round(width*fb[3]/fb[2]);
 xx,yy=np.meshgrid(np.linspace(x0,x1,width),np.linspace(y1,y0,height));lon,lat=INV.transform(xx,yy)
 n=2**z;tx=(lon+180)/360*n;ty=(1-np.arcsinh(np.tan(np.radians(np.clip(lat,-85,85))))/np.pi)/2*n
 elev=np.zeros((height,width),np.float32);present=np.zeros((height,width),np.uint8)
 for px in range(max(0,int(np.floor(tx.min()))),min(n-1,int(np.floor(tx.max())))+1):
  for py in range(max(0,int(np.floor(ty.min()))),min(n-1,int(np.floor(ty.max())))+1):
   file=OLD/'terrain'/str(z)/str(px)/f'{py}.png'
   if not file.exists():continue
   sel=(tx>=px)&(tx<px+1)&(ty>=py)&(ty<py+1)
   if not sel.any():continue
   a=np.asarray(Image.open(file).convert('RGB'),dtype=np.float32);h=a[:,:,0]*256+a[:,:,1]+a[:,:,2]/256-32768
   elev[sel]=map_coordinates(h,[(ty[sel]-py)*255,(tx[sel]-px)*255],order=1);present[sel]=1
 elev=gaussian_filter(elev,.55);dx=(x1-x0)/width;dy=(y1-y0)/height
 shade=LightSource(azdeg=315,altdeg=42).hillshade(elev,vert_exag=3.5,dx=dx,dy=dy)
 tone=.97-.26*(1-shade)-.025*np.clip(elev,0,6000)/6000
 rgb=np.stack([tone+.005,tone+.01,tone+.005],axis=-1).clip(0,1)
 mask=rasterio.features.rasterize([(land,1)],out_shape=(height,width),transform=from_bounds(x0,y0,x1,y1,width,height),fill=0,dtype='uint8')
 # Fade relief at frame edges so high-detail overlays have no hard rectangular edge.
 distance=np.minimum.reduce([np.broadcast_to(np.arange(width)[None,:],(height,width)),np.broadcast_to(np.arange(width-1,-1,-1)[None,:],(height,width)),np.broadcast_to(np.arange(height)[:,None],(height,width)),np.broadcast_to(np.arange(height-1,-1,-1)[:,None],(height,width))]);alpha=(mask*present*np.clip(distance/15,0,1)*255).astype(np.uint8)
 Image.fromarray(np.dstack([(rgb*255).astype(np.uint8),alpha]),'RGBA').quantize(colors=128,method=Image.Quantize.FASTOCTREE).save(OUT/filename,optimize=True)
 return {'url':'./maps/'+filename,'bounds':fb,'minZoom':1 if z==5 else 2 if z==8 else 5,'demZoom':z,'width':width,'height':height,'coverage':round(float(present.mean()),3)}
terrain=[relief((25,-13,180,79),5,3200,'relief-asia.png'),relief((100,20,144,47),8,4000,'relief-east-asia.png'),relief((117,26,124.6,33.3),10,2600,'relief-zhejiang.png')]
physical['relief']=terrain
from name_strategic_regions import apply_city_names
city_report=apply_city_names(atlas)
(OUT/'city-names.json').write_text(json.dumps(city_report,ensure_ascii=False,indent=2))
(OUT/'atlas.js').write_text('/* Generated by scripts/build_atlas.py; licences and sources: maps/SOURCES.md */\nwindow.SHANHE_ATLAS = '+json.dumps(atlas,ensure_ascii=False,separators=(',',':'))+';\n')
report['relief']=terrain;(OUT/'checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print('Atlas assets:',(OUT/'atlas.js').stat().st_size,'bytes',terrain,flush=True)
