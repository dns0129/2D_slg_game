# 图源、数据口径与许可

后续添加的县级 / 地区级细分层使用独立的静态文件，来源、覆盖范围和许可见 [县级区块说明](COUNTIES.md)。以下说明针对最初复制的省级地图；其几何保持原样。

地图前端与静态资源复制自 [dns0129/world_map_history](https://github.com/dns0129/world_map_history)，提交 [29285e0](https://github.com/dns0129/world_map_history/tree/29285e05c747b84620908a2c29d45769a115ba0f)。仅复制原项目 `ww2/maps/` 的地图架构、1939-09-01 与 2026 地块，以及两者共用的地形、水系、字形。源仓库没有修改。

原始说明：[项目 README](https://github.com/dns0129/world_map_history/blob/29285e05c747b84620908a2c29d45769a115ba0f/README.md)、[区划与控制范围说明](https://github.com/dns0129/world_map_history/blob/29285e05c747b84620908a2c29d45769a115ba0f/ww2/README.md)。复制文件的来源校验值在 `data/copy-manifest.json`。

## 数据口径

- **1939** 固定为 1939-09-01，沿用当日区划、法理国界、控制判定、阵营、城市和人口估计。没有省级资料的地方保留整个国家或殖民地。国界或控制线穿过省份时，保留原项目的切块。
- **2026** 是源项目整理的 2026 年世界数据，不随当前日期实时更新。法理归属与实际控制分别着色；近似占领区和交战区保留斜线及详情说明。阵营为原项目的北约、集体安全条约组织、其他国家与交战区口径。
- 人口为原项目的估计，保留作地块属性和详情，不是新增人口模拟。面积按原项目取一位小数，小岛可能四舍五入为零。
- 水系复用原地图的 1939–45 历史河湖底图，包括放大后显示的欧美细部水系；2026 同样沿用该底图。没有在本次复制中校正为现代水库及湖岸。
- 控制范围、区划资料缺口和历史复原误差沿用源数据。详情面板保留界线依据、资料来源与近似说明。

## 来源与许可

| 内容 | 原项目来源 | 许可 |
| --- | --- | --- |
| 前端地图代码 | World_Map_History | CC0（按源 README） |
| 历史国界及台湾历史图层 | CShapes 2.0、中研院台湾历史图层 | CC BY-NC-SA 4.0 |
| 历史行政区划 | OpenHistoricalMap、Newberry 美国县界史、K. Lawson 东亚图层 | CC0 或公有领域（按源 README） |
| 当今区划及人口 | geoBoundaries、GHS-POP 2025 | CC BY 4.0 |
| 河湖与现代政治单元底图 | Natural Earth | 公有领域 |
| 地形 | Mapzen / AWS Terrarium；SRTM、GMTED2010、ETOPO1 等 | 见原项目来源说明 |
| 本地文字字形 | OpenMapTiles 的 Noto Sans 字库 | SIL Open Font License 1.1；见 `vendor/Noto-OFL.txt` |
| 地图引擎 | MapLibre GL JS 4.7.1 | BSD-3-Clause 等；完整声明见 `vendor/LICENSE.txt` |
| 旧浏览器 gzip 解压 | pako 2.1.0 | MIT / Zlib；完整声明见 `vendor/pako.LICENSE.txt` |

包含 CC BY-NC-SA 4.0 数据的地图数据集只用于非商业用途，沿用原项目许可要求。代码许可不改变地理数据和第三方资源各自的许可。
