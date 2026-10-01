"""Create real-geography previews without changing any game file."""
from pathlib import Path
import io, json, math, zipfile, hashlib
import numpy as np
from PIL import Image
import shapefile
from shapely.geometry import shape, mapping, box, Point, MultiPoint, Polygon
from shapely.ops import transform, unary_union, voronoi_diagram
from shapely import make_valid
from pyproj import Transformer, CRS, Geod
from scipy.ndimage import map_coordinates, gaussian_filter
import rasterio.features
from rasterio.transform import from_bounds
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
from matplotlib.path import Path as MPath
from matplotlib.patches import PathPatch
from matplotlib.colors import LightSource
from matplotlib.font_manager import FontProperties
import matplotlib.patheffects as effects

ROOT=Path(__file__).parent
SOURCE=ROOT/'source'
OUT=ROOT/'output'
OUT.mkdir(exist_ok=True)
CRS_MAP=CRS.from_proj4('+proj=laea +lat_0=30 +lon_0=105 +datum=WGS84 +units=m +no_defs')
VIEW_REGIONS={}
TO_MAP=Transformer.from_crs(4326,CRS_MAP,always_xy=True)
TO_GEO=Transformer.from_crs(CRS_MAP,4326,always_xy=True)
FONT=FontProperties(fname='/System/Library/Fonts/PingFang.ttc')
plt.rcParams['font.family']='sans-serif'
plt.rcParams['axes.unicode_minus']=False
SEA='#edf4f5'

def read_zip(name):
    z=zipfile.ZipFile(SOURCE/name)
    def member(ext):return io.BytesIO(z.read(next(n for n in z.namelist() if n.endswith(ext))))
    reader=shapefile.Reader(shp=member('.shp'),shx=member('.shx'),dbf=member('.dbf'),encoding='utf-8')
    return [(r.record.as_dict(),make_valid(shape(r.shape.__geo_interface__))) for r in reader.iterShapeRecords()]

land=read_zip('ne-land.zip')+read_zip('ne-minor-islands.zip')
rivers=read_zip('ne-rivers.zip')
lakes=read_zip('ne-lakes.zip')
admin=read_zip('ne-admin1.zip')
counties=[(f['properties'],make_valid(shape(f['geometry']))) for f in json.loads((SOURCE/'china-counties.geojson').read_text())['features']]
county_centres=np.array([[g.representative_point().x,g.representative_point().y] for _,g in counties])
china_window=box(72,17,138,55)
china_land=unary_union([g.intersection(china_window) for _,g in land if g.intersects(china_window)])

def project(g):return make_valid(transform(TO_MAP.transform,g))
def parts(g):
    if g.is_empty:return []
    if g.geom_type=='Polygon':return [g]
    if hasattr(g,'geoms'):return [p for a in g.geoms for p in parts(a)]
    return []
def polygon_path(g):
    vertices=[];codes=[]
    for poly in parts(g):
        for ring in [poly.exterior,*poly.interiors]:
            coords=np.asarray(ring.coords)
            vertices.extend(coords)
            codes.extend([MPath.MOVETO]+[MPath.LINETO]*(len(coords)-2)+[MPath.CLOSEPOLY])
    return MPath(np.asarray(vertices),codes) if vertices else None
def draw_poly(ax,g,face='none',edge='none',lw=.4,alpha=1,z=2):
    path=polygon_path(g)
    if path is not None:ax.add_patch(PathPatch(path,facecolor=face,edgecolor=edge,lw=lw,alpha=alpha,zorder=z))
def lines(g):
    if g.is_empty:return []
    if g.geom_type in ('LineString','LinearRing'):return [np.asarray(g.coords)]
    if g.geom_type=='Polygon':return lines(g.boundary)
    if hasattr(g,'geoms'):return [p for s in g.geoms for p in lines(s)]
    return []
def text(ax,lon,lat,label,size=9,color='#617371',weight='normal',z=10,**kwargs):
    x,y=TO_MAP.transform(lon,lat)
    return ax.text(x,y,label,fontproperties=FONT,fontsize=size,color=color,weight=weight,zorder=z,ha='center',va='center',path_effects=[effects.withStroke(linewidth=2.5,foreground='#ffffff',alpha=.92)],**kwargs)

# Merge real county polygons into smaller strategic regions. Province exteriors
# remain untouched; residual slivers from source differences are filled only
# inside the original province, so the subdivision has no overlaps or gaps.
special={'Xinjiang':10,'Xizang':8,'Inner Mongol':8,'Qinghai':6,'Sichuan':6,'Yunnan':5,'Gansu':5,'Heilongjiang':5,'Shanghai':1,'Beijing':1,'Tianjin':1,'Chongqing':2,'Ningxia':2,'Hainan':2,'Paracel Islands':1}
tiles=[]
province_shapes={}
checks=[]
for props,geo in admin:
    if props.get('adm0_a3')!='CHN':continue
    name=props['name'];base=project(geo.intersection(china_land))
    if base.is_empty:continue
    province_shapes[name]=(props,base)
    k=special.get(name,4)
    indexes=[i for i,(lon,lat) in enumerate(county_centres) if geo.covers(Point(lon,lat))]
    local=[project(counties[i][1]).intersection(base) for i in indexes]
    local=[g for g in local if not g.is_empty and g.area>100]
    coords=np.array([[g.representative_point().x,g.representative_point().y] for g in local])
    if name=='Zhejiang':
        seeds=np.array([TO_MAP.transform(*p) for p in [(120.2,30.6),(121.35,29.5),(119.4,29.0),(120.1,27.9)]])
        labels=['浙北','浙东','浙中西','浙南']
    elif k==1:
        seeds=np.array([[base.centroid.x,base.centroid.y]]);labels=[props.get('name_zh') or name]
    else:
        if len(coords)>=k:pool=coords
        else:
            candidates=[base.representative_point()]
            candidates.extend(Point(base.bounds[0]+(base.bounds[2]-base.bounds[0])*a,base.bounds[1]+(base.bounds[3]-base.bounds[1])*b) for a,b in [(.25,.25),(.75,.25),(.25,.75),(.75,.75),(.5,.2),(.2,.5),(.8,.5),(.5,.8),(.5,.5)])
            pool=np.array([[p.x,p.y] for p in candidates])
        seeds=[pool[np.argmin(np.linalg.norm(pool-pool.mean(axis=0),axis=1))]]
        for _ in range(k-1):seeds.append(pool[np.argmax(np.min(np.linalg.norm(pool[:,None]-np.array(seeds)[None],axis=2),axis=1))])
        seeds=np.array(seeds)
        if len(coords)>=k:
            for _ in range(15):
                assignment=np.argmin(np.linalg.norm(coords[:,None]-seeds[None],axis=2),axis=1)
                new=np.array([coords[assignment==j].mean(axis=0) if (assignment==j).any() else seeds[j] for j in range(k)])
                if np.max(np.abs(new-seeds))<10:break
                seeds=new
        labels=[(props.get('name_zh') or name).replace('省','').replace('自治区','')+f'·{j+1}' for j in range(k)]
    if k==1:regions=[base]
    else:
        assignment=np.argmin(np.linalg.norm(coords[:,None]-seeds[None],axis=2),axis=1) if len(coords) else np.array([])
        regions=[];claimed=Polygon()
        for j in range(k):
            region=unary_union([g for g,a in zip(local,assignment) if a==j]).difference(claimed)
            regions.append(region);claimed=unary_union([claimed,region])
        remainder=base.difference(claimed)
        cells=list(voronoi_diagram(MultiPoint(seeds),envelope=base.envelope.buffer(1e6)).geoms)
        for j,seed in enumerate(seeds):
            cell=next(c for c in cells if c.covers(Point(seed)))
            regions[j]=make_valid(unary_union([regions[j],cell.intersection(remainder)]))
    merged=unary_union(regions)
    gap=base.symmetric_difference(merged).area/max(base.area,1)
    overlap=(sum(g.area for g in regions)-merged.area)/max(base.area,1)
    checks.append({'province':name,'tiles':k,'coverage_error_ratio':gap,'overlap_ratio':overlap,'valid':all(g.is_valid and not g.is_empty for g in regions)})
    for j,g in enumerate(regions):tiles.append({'province':name,'name':labels[j],'geometry':g,'index':j})
print(f'China subdivision ready: {len(tiles)} regions',flush=True)

def terrain(bounds,width,height,z):
    xmin,ymin,xmax,ymax=bounds
    xx,yy=np.meshgrid(np.linspace(xmin,xmax,width),np.linspace(ymax,ymin,height))
    lon,lat=TO_GEO.transform(xx,yy)
    west,south,east,north=geo_bounds(bounds)
    visible=(lon>=west)&(lon<=east)&(lat>=south)&(lat<=north)
    lon=np.clip(lon,west,east);lat=np.clip(lat,south,north)
    n=2**z
    tx=(lon+180)/360*n
    ty=(1-np.arcsinh(np.tan(np.radians(np.clip(lat,-80,80))))/np.pi)/2*n
    x0,x1=int(np.floor(tx.min())),int(np.floor(tx.max()))
    y0,y1=int(np.floor(ty.min())),int(np.floor(ty.max()))
    mosaic=np.zeros(((y1-y0+1)*256,(x1-x0+1)*256),np.float32)
    missing=[]
    for x in range(x0,x1+1):
        for y in range(y0,y1+1):
            p=SOURCE/'terrain'/str(z)/str(x)/f'{y}.png'
            if not p.exists():missing.append((z,x,y));continue
            a=np.array(Image.open(p),dtype=np.float32)
            mosaic[(y-y0)*256:(y-y0+1)*256,(x-x0)*256:(x-x0+1)*256]=a[:,:,0]*256+a[:,:,1]+a[:,:,2]/256-32768
    if missing:print('Missing terrain outside preview bounds:',len(missing),flush=True)
    elev=map_coordinates(mosaic,[(ty-y0)*256-.5,(tx-x0)*256-.5],order=1,mode='nearest')
    elev=gaussian_filter(elev,.5)
    dx=(xmax-xmin)/width;dy=(ymax-ymin)/height
    shade=LightSource(azdeg=315,altdeg=42).hillshade(elev,vert_exag=4,dx=dx,dy=dy)
    tone=.97-.31*(1-shade)-.025*np.clip(elev,0,6000)/6000
    rgb=np.stack([tone+.009,tone+.014,tone+.008],axis=-1).clip(0,1)
    clip_geo=box(*geo_bounds(bounds))
    relevant=[project(g.intersection(clip_geo)) for _,g in land if g.intersects(clip_geo)]
    mask=rasterio.features.rasterize([(g,1) for g in relevant],out_shape=(height,width),transform=from_bounds(*bounds,width,height),fill=0,dtype='uint8')
    return np.dstack([rgb,mask*visible*.96])

def geo_bounds(bounds):
    if tuple(bounds) in VIEW_REGIONS:return VIEW_REGIONS[tuple(bounds)]
    x0,y0,x1,y1=bounds
    xs=np.linspace(x0,x1,20);ys=np.linspace(y0,y1,20)
    lon,lat=TO_GEO.transform(np.r_[xs,xs,np.full(20,x0),np.full(20,x1)],np.r_[np.full(20,y0),np.full(20,y1),ys,ys])
    return min(lon),min(lat),max(lon),max(lat)
def extent(w,s,e,n):
    lon=np.r_[np.linspace(w,e,80),np.linspace(w,e,80),np.full(80,w),np.full(80,e)]
    lat=np.r_[np.full(80,s),np.full(80,n),np.linspace(s,n,80),np.linspace(s,n,80)]
    x,y=TO_MAP.transform(lon,lat)
    bounds=(min(x),min(y),max(x),max(y));VIEW_REGIONS[bounds]=(w,s,e,n);return bounds

def base_map(ax,bounds,z=6,detail=False):
    x0,y0,x1,y1=bounds
    ax.set_facecolor(SEA);ax.set_xlim(x0,x1);ax.set_ylim(y0,y1);ax.set_aspect('equal')
    ax.set_xticks([]);ax.set_yticks([])
    for spine in ax.spines.values():spine.set_color('#dbe3e1')
    west,south,east,north=geo_bounds(bounds)
    clip_geo=box(west,south,east,north)
    footprint=Polygon(np.column_stack(TO_MAP.transform(np.r_[np.linspace(west,east,100),np.full(100,east),np.linspace(east,west,100),np.full(100,west)],np.r_[np.full(100,south),np.linspace(south,north,100),np.full(100,north),np.linspace(north,south,100)])))
    clip_map=box(*bounds).intersection(footprint)
    # Graticule lines are derived from coordinates, not a stretched rectangular grid.
    step=1 if detail else 10
    gwest,gsouth,geast,gnorth=clip_geo.bounds
    for lon in range(math.floor(gwest/step)*step,math.ceil(geast)+1,step):
        lat=np.linspace(gsouth,gnorth,150);x,y=TO_MAP.transform(np.full(150,lon),lat);ax.plot(x,y,color='#dce7e7',lw=.4,zorder=0)
    for lat in range(math.floor(gsouth/step)*step,math.ceil(gnorth)+1,step):
        lon=np.linspace(gwest,geast,150);x,y=TO_MAP.transform(lon,np.full(150,lat));ax.plot(x,y,color='#dce7e7',lw=.4,zorder=0)
    for _,g in land:
        if g.intersects(clip_geo):draw_poly(ax,project(g.intersection(clip_geo)).intersection(clip_map),face='#fbfcf9',edge='#a9bdbc',lw=.42,z=1)
    width=2000 if not detail else 1500;height=max(200,int(width*(y1-y0)/(x1-x0)))
    relief=terrain(bounds,width,height,z)
    ax.imshow(relief,extent=(x0,x1,y0,y1),origin='upper',zorder=2,interpolation='bilinear')
    # Provincial borders outside China remain real ADM1 polygons.
    for props,g in admin:
        if not g.intersects(clip_geo):continue
        if props.get('adm0_a3')!='CHN':draw_poly(ax,project(g.intersection(clip_geo)).intersection(clip_map),edge='#b7c5c1',lw=.32,z=3)
    for tile in tiles:
        g=tile['geometry']
        if g.intersects(clip_map):draw_poly(ax,g.intersection(clip_map),edge='#9fafa9',lw=.45 if detail else .3,z=4)
    for name,(props,g) in province_shapes.items():
        if g.intersects(clip_map):draw_poly(ax,g.intersection(clip_map),edge='#758a83',lw=.75 if detail else .54,z=5)
    for props,g in lakes:
        if g.intersects(clip_geo):draw_poly(ax,project(g.intersection(clip_geo)).intersection(clip_map),face=SEA,edge='#a6c2c5',lw=.3,z=6)
    for props,g in rivers:
        if g.intersects(clip_geo):
            rank=props.get('scalerank',8) or 8
            width=(1.1 if detail else .7) if rank<=3 else (.65 if detail else .42)
            segments=lines(project(g.intersection(clip_geo)).intersection(clip_map))
            if segments:ax.add_collection(LineCollection(segments,colors='#7ba8b4',linewidths=width,zorder=7,alpha=.88))
    for _,g in land:
        if g.intersects(clip_geo):
            shore=lines(project(g.boundary.intersection(clip_geo)).intersection(clip_map))
            if shore:ax.add_collection(LineCollection(shore,colors='#8da9a4',linewidths=.55 if detail else .36,zorder=8,alpha=.9))
    # North arrow and a real distance scale in the projection plane.
    ax.text(.96,.965,'N',transform=ax.transAxes,fontsize=9,color='#7d9392',ha='center',zorder=20)
    ax.annotate('',xy=(.96,.95),xytext=(.96,.91),xycoords='axes fraction',arrowprops=dict(arrowstyle='-|>',color='#819794',lw=.7),zorder=20)
    km=100 if detail else 500
    start=x0+.05*(x1-x0);y=y0+.065*(y1-y0)
    anchor_lon,anchor_lat=TO_GEO.transform(start,y)
    dist=np.linspace(0,km*1000,30)
    scale_lon,scale_lat,_=Geod(ellps='WGS84').fwd(np.full(30,anchor_lon),np.full(30,anchor_lat),np.full(30,90),dist)
    sx,sy=TO_MAP.transform(scale_lon,scale_lat)
    ax.plot(sx,sy,color='#526c67',lw=1.2,zorder=20)
    tick=6000 if detail else 24000
    for x,yy in [(sx[0],sy[0]),(sx[-1],sy[-1])]:ax.plot([x,x],[yy-tick,yy+tick],color='#526c67',lw=.8,zorder=20)
    ax.text((sx[0]+sx[-1])/2,(sy[0]+sy[-1])/2+.015*(y1-y0),f'{km} km',ha='center',fontsize=8,color='#6d8581',zorder=20)

def title(fig,kicker,heading,sub):
    fig.text(.055,.956,kicker,fontproperties=FONT,fontsize=10,color='#7e9590')
    fig.text(.055,.915,heading,fontproperties=FONT,fontsize=25,color='#263f38')
    fig.text(.055,.881,sub,fontproperties=FONT,fontsize=10,color='#7f928b')
    fig.text(.945,.949,'山河棋局 / 地图预览 V2',fontproperties=FONT,fontsize=10,color='#738c84',ha='right')
    fig.text(.055,.027,'海岸、河流：Natural Earth 1:10,000,000  |  地块：真实省界 + geoBoundaries 县界合并  |  地形：Mapzen / USGS SRTM & GMTED2010 / NOAA ETOPO1',fontproperties=FONT,fontsize=7,color='#8a9a94')
    fig.text(.055,.013,'统一 Lambert 方位等面积投影；横纵轴使用相同米制比例。现代地理底图预览，历史势力归属将在剧本层配置。',fontproperties=FONT,fontsize=7,color='#8a9a94')

fig=plt.figure(figsize=(16,12),facecolor='#ffffff')
ax=fig.add_axes([.04,.055,.92,.805])
title(fig,'01 / 中国地理底图','真实山河 · 更细的战略地块',f'中国区域 {len(tiles)} 个候选地块 · 浙江 4 块 · 上海 1 块 · 白色地形与真实水系')
base_map(ax,extent(72,17,138,55))
for name,(props,g) in province_shapes.items():
    if name in ['Paracel Islands','Shanghai','Beijing','Tianjin','Chongqing','Hainan']:continue
    p=g.representative_point();ax.text(p.x,p.y,(props.get('name_zh') or name).replace('省','').replace('维吾尔自治区','').replace('壮族自治区','').replace('回族自治区','').replace('自治区',''),fontproperties=FONT,fontsize=8,color='#5c7067',ha='center',zorder=11,path_effects=[effects.withStroke(linewidth=2,foreground='white',alpha=.85)])
for lon,lat,label in [(121.47,31.23,'上海'),(116.4,39.9,'北京'),(104.06,30.67,'成都'),(114.31,30.59,'武汉')]:text(ax,lon,lat,label,size=7.5,color='#41665e')
for lon,lat,label in [(89,29.2,'喜马拉雅山脉'),(88,36,'昆仑山脉'),(108,33.5,'秦岭'),(113.3,37.5,'太行山'),(122.7,26.5,'东 海'),(114.5,18.5,'南 海')]:text(ax,lon,lat,label,size=8,color='#91a49a')
fig.savefig(OUT/'china-map.png',dpi=160);plt.close(fig)
print('China map rendered',flush=True)

fig=plt.figure(figsize=(16,13),facecolor='#ffffff');ax=fig.add_axes([.04,.055,.92,.81])
title(fig,'02 / 二战亚洲共用地理底图','亚洲战区 · 真实海陆比例','中国、朝鲜半岛、日本、南亚、东南亚与群岛统一使用真实坐标；山体由高程数据生成')
base_map(ax,extent(66,-12,148,61))
for lon,lat,label in [(104,35,'中国'),(99,48,'蒙古高原'),(102,57,'西伯利亚'),(137,37,'日本'),(126.4,39,'朝鲜半岛'),(79,23,'印度'),(95.4,21,'缅甸'),(100.3,15.5,'泰国'),(106.5,17,'越南'),(123,12,'菲律宾'),(111,-1,'婆罗洲'),(106,-7,'爪哇'),(100,0,'苏门答腊')]:text(ax,lon,lat,label,size=9,color='#627b72')
for lon,lat,label in [(137,13,'太 平 洋'),(82,2,'印 度 洋'),(116,14,'南 海'),(124,28,'东 海')]:text(ax,lon,lat,label,size=11,color='#a4bcbc')
fig.savefig(OUT/'asia-map.png',dpi=160);plt.close(fig)
print('Asia map rendered',flush=True)

fig=plt.figure(figsize=(14,11),facecolor='white');ax=fig.add_axes([.045,.07,.69,.79])
title(fig,'03 / 地块粒度验收','浙江 4 块 · 上海 1 块','真实海岸线与县级边界合并，保持上海、浙江及周边地区的相对大小')
base_map(ax,extent(117.8,26.9,123.3,32.4),z=10,detail=True)
colors=['#b0cfba','#c4d6cb','#bdcaba','#d0cbb6']
ztiles=[t for t in tiles if t['province']=='Zhejiang']
for t,c in zip(ztiles,colors):
    draw_poly(ax,t['geometry'],face=c,alpha=.21,z=8)
    draw_poly(ax,t['geometry'],edge='#5b8170',lw=1.1,z=9)
    p=t['geometry'].representative_point();ax.text(p.x,p.y,t['name'],fontproperties=FONT,fontsize=12,color='#375c4b',ha='center',zorder=12,path_effects=[effects.withStroke(linewidth=3,foreground='white',alpha=.94)])
draw_poly(ax,province_shapes['Shanghai'][1],face='#b7ced1',alpha=.32,z=8)
draw_poly(ax,province_shapes['Shanghai'][1],edge='#587b86',lw=1.2,z=9)
for lon,lat,label in [(120.15,30.27,'杭州'),(121.54,29.87,'宁波'),(120.70,27.99,'温州'),(119.65,29.08,'金华'),(121.47,31.23,'上海'),(122.2,29.985,'舟山')]:
    x,y=TO_MAP.transform(lon,lat);ax.scatter([x],[y],s=9,c='#36574f',edgecolors='white',linewidths=.5,zorder=13);text(ax,lon+.1,lat+.075,label,7.5,color='#526e63')
text(ax,122.65,28.3,'东 海',size=13,color='#a4bbba')
fig.text(.77,.78,'划分方案',fontproperties=FONT,fontsize=15,color='#2e4e40')
for i,t in enumerate(ztiles):
    fig.text(.77,.71-i*.115,f'0{i+1}  {t["name"]}',fontproperties=FONT,fontsize=12,color='#4d6c59')
    fig.text(.77,.677-i*.115,f'约 {t["geometry"].area/1e6:,.0f} km²',fontproperties=FONT,fontsize=9,color='#8b9b91')
fig.text(.77,.20,'上海：1 个独立地块\n\n细线：战略地块\n粗线：省级边界\n蓝线：真实河流\n明暗：真实高程地形',fontproperties=FONT,fontsize=10,color='#7a8f82',linespacing=1.8)
fig.savefig(OUT/'zhejiang-shanghai-detail.png',dpi=180);plt.close(fig)
print('Zhejiang and Shanghai detail rendered',flush=True)

geojson={'type':'FeatureCollection','features':[{'type':'Feature','properties':{'province':t['province'],'name':t['name'],'index':t['index']},'geometry':mapping(transform(TO_GEO.transform,t['geometry']))} for t in tiles]}
(OUT/'candidate-territories.geojson').write_text(json.dumps(geojson,ensure_ascii=False,separators=(',',':')))
report={'projection':CRS_MAP.to_proj4(),'territory_count':len(tiles),'zhejiang_count':len(ztiles),'shanghai_count':len([t for t in tiles if t['province']=='Shanghai']),'subdivision_checks':checks,'maximum_coverage_error':max(c['coverage_error_ratio'] for c in checks),'maximum_overlap':max(c['overlap_ratio'] for c in checks),'game_files_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in ROOT.parent.parent.glob('*') if p.name in ['index.html','game.js','styles.css']},'sources':{'physical':'https://www.naturalearthdata.com/downloads/10m-physical-vectors/','administrative':'https://www.geoboundaries.org/api.html','elevation':'https://registry.opendata.aws/terrain-tiles/'}}
(OUT/'map-checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
assert report['maximum_coverage_error']<1e-6 and report['maximum_overlap']<1e-6
assert all(c['valid'] for c in checks)
print('Geometry checks passed',flush=True)
