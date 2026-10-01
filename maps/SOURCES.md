# 历史地图数据、精度与许可

本版把自然地理、年代行政底图和游戏控制权分别存储。地图能直接用于游戏，但不是全亚洲所有年代的权威历史 GIS 定本。

## 起始断面

| 剧本 | 日期 | 区划结构 | 当前精度 |
|---|---|---|---|
| 三国鼎立 | 222 年，夷陵战后 | 州 / 郡、国、属国；长安等历史治所 | 219 年历史复原底图配准，核对部分 220–222 沿革；不闭合、标注歧义的边界保留联合郡域 |
| 二战亚洲 | 1941-12-06 | 民国历史省界、日本府县、朝鲜十三道、台湾州厅、缅甸县邦、东印度驻扎区、印度土邦、马来亚州及海峡殖民地、印度支那保护地 / 省 | 各地区底本年代不同，地块情报逐块标明；不是现代国家政区简单换名 |

每回合推进一个月，模拟之后的战局；历史行政底图保持剧本起始断面。

### 已核对的年代差异

- 三国地图使用长安、吴郡、会稽郡、益州郡等，未使用浙江省、建宁郡、临海郡、东阳郡、吴兴郡、广州等后设建制。
- 三国图以新城郡域替换上庸、房陵、西城的旧分法；底图固陵郡域合入宜都，宕渠域并回巴西。后两者具体细界仍为复原。
- 巴东属国于蜀汉章武元年（221）改为涪陵郡，已调整名称。见[重庆地方志](https://dfz.cq.gov.cn/fzyd/qk/202509/P020250929506134778061.pdf)。
- 汉阳改天水的年份，地方志有 220 年与魏明帝时两种记载。本版取黄初元年说，并公开异记，未当作无争议定论。见[天水建置沿革](https://www.tianshui.gov.cn/dsb/info/1783/27662.htm)。
- 西康省在二战起始断面已经设立，热河、察哈尔、绥远仍以当时省名显示。东北使用国民政府法理省界，游戏控制者另列满洲国；不套用 1935 年满洲国十四省作为 1941 定本。
- 东京在 1941 年仍是东京府，1943-07-01 才改东京都。见[东京都官方年表](https://www.metro.tokyo.lg.jp/tosei/tokyoto/profile/gaiyo/nenpyo)。
- 朝鲜显示十三道；济州合回全罗南道，不套用 1946 年以后的济州道。
- 香港、菲律宾、缅甸、荷属东印度在 1941-12-06 尚未被日军占领。法属印度支那仍保留法国殖民行政，日本军事驻扎不等于行政区主权全面改属日本。
- 吉打、玻璃市、吉兰丹、登嘉楼在 1941 年仍属英国保护体系，不套用 1943 年转交泰国的边界。天定自 1935 年归霹雳，不继续列作独立海峡殖民地辖区。
- 法泰条约在 1941 年割让的柬埔寨、老挝部分另列，不误用战后国界。
- 二战图更换为 1938–1947 年黄河决口后的河道。

## 自然地理与投影

- 自然地理：Natural Earth 1:10m 海岸、岛屿、水系、湖泊，public domain。见[数据许可](https://www.naturalearthdata.com/about/terms-of-use/)。本版采用现代公开自然地理外缘，未宣称古代岸线已逐段复原。
- 矢量投影：Lambert Azimuthal Equal Area，中心 105°E / 30°N。横纵轴相同缩放，地图单位 10 km。地图不能在整个亚洲同时保持每一处距离和角度完全无失真；比例尺标为近似。
- 山体：Mapzen Terrarium 真实高程，来源包括 SRTM 等开放高程资料。见[开放高程说明与归属](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)。亚洲概览 z5，中国东部、日本、朝鲜 z8，浙江局部 z10；阴影山体为平面投影中的地形效果。
- 山体是栅格图，放大有源分辨率限制；政区和水系为矢量，可继续缩放。水系底本不含每一条溪流。
- 古代河道尚未全量历史复原。二战黄河使用专门年代图层，其余主要水系沿用公开地理底图。

## 历史图源与许可

| 数据 | 出处 | 许可 / 注意 |
|---|---|---|
| 建安州郡复原图 | [Esiymbro，Jian'an Commanderies](https://commons.wikimedia.org/wiki/File:Jian%27an_Commanderies.svg)，参考李晓杰《东汉政区地理》及谭其骧《中国历史地图集》 | CC BY-SA 4.0；配准、修补和联合域是本项目对该地图的改编，衍生界线继续同许可 |
| 民国省界 | [Lilauid，Republic of China edcp location map 1936](https://commons.wikimedia.org/wiki/File:Republic_of_China_edcp_location_map_1936.svg)，由 Konrad Lawson 配准、描摹 | CC BY-SA 4.0，承袭底本 Uwe Dedering 的 attribution；1936 底本不意味着全部建制已在 1936 生效 |
| 亚洲历史行政资料及描摹 | [Konrad Lawson，An interactive map of the Japanese Empire](https://github.com/kmlawson/japanese-empire-student-map)，[原始资料目录](https://froginawell.net/reference/japanese-empire/sources.html) | 作者自身的代码、文字、配准和描摹为 CC0；底层地图各自许可仍适用；随附原项目 LICENSE.md 保留完整归属 |
| 日本府县、菲律宾省、马来亚州等底层几何 | geoBoundaries，Runfola et al. 2020，部分依历史结构归并 | CC BY 4.0；现代边界配准不等于已逐界验证的历史县界 |
| 韩国十三道 | 历史地图描摹，Konrad Lawson 配准；合并济州未来建制 | CC0 描摹工作；来源说明见上方项目目录 |
| 台湾州厅 | 中央研究院日治行政区划资料，1926 郡市几何合成州厅；蕃地保留为山地合域 | 原资料 CC BY-NC-SA 4.0；当前版本不提供全套经 1941 核实的市郡细界 |
| 缅甸县邦 / 印度土邦 | 1931 Census / Imperial Gazetteer 底图，Konrad Lawson 描摹 | CC0 描摹工作；1931–1941 所有小变化尚未逐条核完 |
| 荷属东印度驻扎区 | Robert Cribb 历史图集及历史制度归并的 1941 图层 | 作者配准 CC0；部分底层现代几何 geoBoundaries CC BY 4.0 |
| 法属印度支那 | 历史保护地结构、1945 OSS 底图、1941 割地图层 | 描摹 CC0，部分底层 geoBoundaries CC BY 4.0；晚四年的省界微调尚未逐项核实 |
| 西亚及苏联国家外缘 | [ETH CShapes 2](https://icr.ethz.ch/data/cshapes/)，取有效期覆盖 1941-12-06 的记录 | CC BY-NC-SA 4.0；只表示当时国家外缘，未伪造省州细界 |
| 1938–1947 黄河 | Chris Courtney / DisasterHistory，after Saito et al. 2000；Konrad Lawson 描摹 | 描摹工作 CC0；原图归属见 [DisasterHistory](https://disasterhistory.org/) |
| 中国省内游戏分区 | 真实地理资料，geoBoundaries 县域归并后裁剪到民国省界 | 现代内部地理只用作战略分区，绝不标为核实后的 1941 督察区或县界；底层 PDDL / 历史外缘 CC BY-SA 4.0 |

地图数据的许可不自动改变游戏引擎代码的许可。CC BY-SA、CC BY-NC-SA、ODbL 等来源各自条件仍需遵守；不能把本地图全体宣称为可任意商业再授权的自制数据。

## 代表地名

中国省内的 125 个游戏地块（含上海一块）使用代表城市或聚落名称，取消编号分区。坐标来自 [Natural Earth populated places](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/) 与补充的聚落参考点；每个点通过所在战略地块的几何包含检查，记录见 `city-names.json`。这是命名和标签定位，不是把现代城市行政界搬入历史地图。偏远牧区以代表聚落命名，部分聚落的具体年代沿革仍需精校。

1941 层使用北平、迪化、奉天、承化、宁夏、归绥、铁骊、潍县等年代名称。补充核对：[丁青县政府沿革](https://dingqing.changdu.gov.cn/dqx/c105853/202005/a735ff9a141c461790b6d3402c4d5fa5.shtml)说明原丁青宗等结构；[银川地方党史](https://dsyjs.yinchuan.gov.cn/dsyj/dstd/201706/t20170616_262397.htm)保留同期“宁夏”称谓。脚本中的现代别名只用于搜索与坐标查找。

## 明确未完成的历史精校

1. **中国 1941 年省内县界 / 行政督察区界未完成。** ENP-China 公布有 1934 县界资料，但本轮其公开 GIS 门户无法访问。当前浙江四区等是战略分区；上海可玩市域也为复原域。它们不等于已核实的 1941 行政细界。
2. 三国部分郡界在底图中没有闭合、或治所 / 标签有歧义，保留联合域。当前不是所有州郡逐一核完的 222 定本；不把合域冒称一个史实行政单位。
3. 部分地区使用跨年历史底本，各地块 `basis`、`note`、`source` 公开说明，后续应按史料补齐差分。
4. 游戏初始军队、收入、控制权是玩法抽象，尤其不能把一个大分区着色理解为日军控制区内每一寸土地。
5. 海路是供游戏行军的连通边，不冒称全部真实历史航线。陆路邻接从 GIS 边界生成，允许不超过 5 km 的跨图源配准容差，并检查连接段在陆地上；海路只连接临海地块。独立图源配准存在公里量级误差。

## 数据如何扩展到新剧本

`atlas.scenarios` 每个版本有独立 `date`、`mapVersion`、`units`、`regions`、`adjacency`、`cities`；自然地理共享 `physical`。`units` 保存 `parent`、`kind`、`validFrom`、`validTo`、`basis`、`source`、`note` 和矢量边界。

新增剧本必须准备该年代的历史底图及差分，不能只改标签。可在新剧本 `meta` 内提供 `name`、`era`、`year`、`subtitle`、`description`、`caption`、`factionIds`、`factions`，引擎将自动发现和显示，不需要再次修改游戏逻辑。

原始图源与配准控制点保存在 `previews/historical-atlas-v3/source/`。生成器是 `scripts/build_atlas.py`，高程缓存抓取器是 `scripts/fetch_atlas_terrain.py`。构建依赖 Shapely、pyproj、rasterio、SciPy、Pillow、Matplotlib、pyshp；运行游戏不需要这些依赖。

存档只保存控制权、军队、经济、回合与视角，不重复写入几何。旧 v1 存档保留，新图使用独立 v3 存档。
