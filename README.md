# 世界地图 · 1939 / 2026

从 [world_map_history](https://github.com/dns0129/world_map_history) **复制**的独立地图基础，替换本仓库原来的亚洲策略游戏。源仓库保持原样。

保留地图铺满窗口的版面、缩放和平移、省级地块、阵营、法理国家和实际控制国，以及省份查询、国家 / 省份详情、城市、河流、地形和图层开关。顶部只有两个年份：

| 地图 | 地块 | 省级单位 | 实际控制者 |
| --- | ---: | ---: | ---: |
| 1939（固定 1939-09-01） | 1,350 | 1,214 | 69 |
| 2026（原项目的 2026 数据） | 3,523 | 3,515 | 208 |

## 打开地图

在仓库根目录启动静态服务器：

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Windows 可以改用 `py -3 -m http.server 8765 --bind 127.0.0.1`。

浏览器打开 <http://127.0.0.1:8765/>；停止服务器时按 `Ctrl+C`。地图通过 HTTP 读取本地文件，需要支持 WebGL 的现代浏览器，不能直接双击 HTML。地图引擎、解压库、地形与字形均在仓库内，打开时无需访问在线地图或 CDN。

入口也可使用 `/1939-09-01.html` 和 `/2026.html`。例如 `/2026.html#2026/control` 直接显示 2026 控制国视图。根目录可由 GitHub Pages 静态发布，保留 `.nojekyll`。

滚轮、双指或地图按钮缩放（桌面右下角、手机右上角）；拖动地图平移。首次点击地块选中国家，再点击同一国家进入省级；面板顶部可返回国家。手机端点“展开”显示图例和图层。

## 代码与数据

```text
index.html / 1939-09-01.html / 2026.html   三个静态入口，共用版面
app.js                                  MapLibre 渲染、交互、详情与数据加载
styles.css                              原地图的桌面与手机版面
vendor/                                 MapLibre GL JS、pako 与许可
data/index.json                         仅 1939 和 2026 的清单
data/admin.bin                          仅两张地图使用的共享区划属性
data/snap-*.json / geo-*.bin              两套地块属性和原始几何
data/relief/ / glyphs/ / hydro*.bin       本地地形、字形与水系
data/copy-manifest.json                  复制来源、提交与文件 SHA-256
scripts/copy_world_map.py                从独立源检出目录重复复制
scripts/verify_data.py                   区划、几何和控制国完整性检查
scripts/verify_browser.cjs               真实浏览器交互验证
docs/SOURCES.md                          来源、数据口径与许可
```

运行时只加载静态地图文件。未复制 SQLite 日期切面数据库、其他年份地图、逐年人口 / GDP 数据库及其构建流水线。旧的回合、征兵、战斗和存档代码已经删除。

共享区划属性由 11,148 个单位精简到两张地图实际使用的 4,729 个单位，地块 / 省份 / 国界索引同步重排。`geo-*.bin` 的边界坐标与源文件逐字节一致；`snap-*.json` 仍是地图必需的静态地块属性，并非数据库。

## 检查与再次复制

只检查数据，不需要安装 Node 依赖：

```sh
python3 scripts/verify_data.py
```

检查浏览器交互：

```sh
npm ci
npx playwright install chromium
npm test
```

已有 Chromium 时，可用 `CHROMIUM_PATH=/usr/bin/chromium npm test`。截图和报告生成于 `test-results/`，不提交到仓库。

再次复制会覆盖本仓库的地图前端和数据，应在需要同步源地图时执行。源目录始终只读：

```sh
python3 scripts/copy_world_map.py /path/to/world_map_history
python3 scripts/verify_data.py
```

本次复制固定来源提交 `29285e05c747b84620908a2c29d45769a115ba0f`。数据口径及许可见 [图源说明](docs/SOURCES.md)。
