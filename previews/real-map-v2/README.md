# 真实地图预览 V2

此文件夹为独立地图评审材料，尚未接入游戏。根目录的 `index.html`、`styles.css` 和 `game.js` 不做修改。

## 地理与设计

- 地理坐标统一转换到 Lambert 方位等面积投影，中心为东经 105°、北纬 30°。横纵轴使用相同米制单位，不单独拉伸国家、省份或岛屿。
- 海岸、岛屿、湖泊与主要河流：Natural Earth 1:10,000,000 原始矢量数据，公开领域。
- 地块省界：Natural Earth ADM1；省内合并：geoBoundaries CHN ADM2 县界。上海为 1 块，浙江为 4 块，普通省份约 4 块，大面积省区适度增加。
- 地形：Mapzen Terrain Tiles 原始高程。大陆图使用 zoom 6，浙江细节使用 zoom 10；按真实高程计算明暗，保留平面视角。
- 历史势力归属和历史地名属于后续剧本层；这一版先评审现实地理底图。

## 查看

打开 `preview.html` 切换三个预览和缩放。最终 PNG、候选地块 GeoJSON 和几何检查报告放在 `output/`。

## 数据来源与署名

- Natural Earth: https://www.naturalearthdata.com/downloads/10m-physical-vectors/
- geoBoundaries: https://www.geoboundaries.org/api.html （县界所注明来源为国家测绘地理信息局 / Revolutionary GIS，PDDL；下载日期 2026-09-30）
- Mapzen Terrain Tiles: https://registry.opendata.aws/terrain-tiles/
- SRTM and GMTED2010 terrain data courtesy of the U.S. Geological Survey.
- Global ETOPO1 terrain data: DOC/NOAA/NESDIS/NCEI, U.S. Department of Commerce.
- Attribution details: https://github.com/tilezen/joerd/blob/master/docs/attribution.md

数据具有各自的制图分辨率；主要河流与海岸没有手绘替代，但本预览不包含每条细小支流或测绘级岸线。
