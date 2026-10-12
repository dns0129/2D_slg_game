# 县级 / 地区级区块

细分层在世界地图的现有省级地块上增加真实行政区轮廓。县、郡、市镇、地区、部门等在各国的地位不同，详情保留原始类别，并区分“县级”与“地区级”。

| 地图 | 独立细分单位 | 按省界 / 控制线切开的区块 | 按省分包 | 涉及控制国 |
| --- | ---: | ---: | ---: | ---: |
| 1939-09-01 | 4,259 | 4,426 | 305 | 36 |
| 2026 | 13,494 | 14,712 | 303 | 17 |

“涉及控制国”表示其中有地区获得细分资料，并不表示全境县界齐全。无资料的地区仍显示原来的省级地块。按当前视口及少量周边余量加载对应省份的细分文件；已有区域不重复提交几何。缩放低于 4.5 自动隐藏县块，低于 3.9 释放渲染数据，避免临界缩放反复加载。浏览器另保留最多 32 个分包的缓存，县级数据共约 13 MB，不在世界视图一次性下载。地块与地名点在同一 GeoJSON 数据源中提交，保持同批更新。

县级地块从缩放 4.5 开始显示，与搜索省份的缩放一致。顶部“查看县级地块示例”直接打开真实小区块；省份详情明确提示是否已有细分资料，覆盖列表按当前年份显示。1939 的中国大陆县界资料目前很少，不能将现代区县当作当时的行政界线。

## 历史边界

1939 的资料来自 [world_map_history 县级版本 430e8b9](https://github.com/dns0129/world_map_history/tree/430e8b9c99fdf05be2d4f094e64659a75fdf4100)，只读取它的静态地图文件，筛选当日有效的县级和地区级单位。美国县界来自 Newberry 历史县界资料，其他地区包括 OpenHistoricalMap 按日期记录的区划、台湾 1930 郡市、缅甸 1931 地区、法属印度支那和荷属东印度等。

不使用以设施点位生成 Voronoi 的朝鲜县界，不把今日县界放到 1939；也不采用旧编码器为极小单位生成的代用三角形。每个区块保留原始名称、类别、施行日期、界线依据和来源。

原始图源许可继承原项目：Newberry、OpenHistoricalMap 和 Lawson 自制历史轮廓为 CC0 / 公有领域；台湾郡市来自 Academia Sinica，按 CC BY-NC-SA 4.0 使用。仅地图数据层包含相应来源，不添加日期切面数据库。

## 现代边界与资料年份

| 图源 | 新增独立单位 | 资料版本 | 许可 |
| --- | ---: | --- | --- |
| [Plotly 数据副本中的美国 Census 县界](https://github.com/plotly/datasets/blob/0c447c47b757ad74edecab31f0d72f849d2e67c2/geojson-counties-fips.json) | 3,221 | 2010 人口普查资料 | 美国政府公有领域 |
| [mapchina 0.1.0 区县](https://github.com/xmc811/mapchina/tree/053136c1c9c01742681bf9224ecad4d8c0bf9df0) | 2,901 | 2018 前后，包括大陆、港澳台 | GPL-3.0 |
| [DataMeet 印度地区界](https://github.com/datameet/maps/tree/b3fbbde595310b397a55d718e0958ce249a4fa1f/Districts) | 640 | 2011 Census districts | CC BY 2.5 India |
| [IBGE / geodata-br 巴西市镇](https://github.com/tbrugz/geodata-br/tree/c39dfb040bfd466fe2a476bafed00749c5c42f16) | 5,563 | 仓库 2021 年版本 | CC0-1.0 |
| [Natural Earth 原始细分行政区](https://github.com/nvkelso/natural-earth-vector/tree/ca96624a56bd078437bca8184e78163e5039ad19) | 1,169 | 仓库 2022 年版本，1:1000 万制图轮廓 | 公有领域 |

Natural Earth 细分包括英国、法国、意大利、西班牙、菲律宾、斯洛文尼亚、拉脱维亚、马耳他、北马其顿、科索沃、布基纳法索和几内亚；它们在原地图中合并为较大的单位，本次恢复可获取的细分轮廓。不同国家的单位不统一改称县。

这些文件是可获取的真实区划版本，不宣称全是 2026 最新县界。地块详情明确显示资料年份。县级层只继承现有省级地块的法理归属、控制国、阵营与配色，不改变原地图的控制判定，也不把省级人口平均分配到县级。

跨过现有省界或控制线的区块按原有地块裁切，详情标为“部分”。少量不与原地图陆地轮廓相交的单位没有导出。中国图源采用 WGS84 区县数据，保留其原始名称与代码；东莞、中山、儋州、嘉峪关四个不设县级区的地级市按地区级显示。

mapchina 来源的导出区县数据继续按 GPL-3.0 提供，完整许可在 [GPL-3.0.txt](../vendor/GPL-3.0.txt)。对应原始数据在上表固定提交的 `data/china.rda`，本仓库的导出修改由下面的脚本复现。其他来源的许可不因此改变。

## 数据与重建

`data/counties/index-<年份>.bin` 为 gzip JSON，记录覆盖区域、分包边界、查询名称和图源信息。`data/counties/<年份>/<省索引>.bin` 为 gzip GeoJSON，区块中的 `k` 指向原地图的省级控制区，`p` 指向共享省份属性；坐标为 WGS84。原来的 `geo-*.bin`、省级属性、国界和控制线保持原样。

所有图源固定到 Git 提交，输入文件 SHA-256 在 `data/counties/manifest.json`，分包 SHA-256 在每个年份的索引中。构建检查所有输出多边形有效且位于对应省级控制区内；读取验证检查索引、日期、坐标、文件校验值和图源许可。

在仓库之外准备原始图源缓存，不需要 R 或 SQLite：

```sh
python3 -m venv /tmp/county-build-env
/tmp/county-build-env/bin/pip install -r scripts/requirements-counties.txt
python3 scripts/download_county_sources.py /tmp/county-sources
/tmp/county-build-env/bin/python scripts/build_counties.py /tmp/county-sources
npm run test:data
```

该流程读取公开静态资料，不写入或删除 `world_map_history`。新增图源可接入构建脚本，再输出同样的分包格式，继续扩大全球覆盖。
