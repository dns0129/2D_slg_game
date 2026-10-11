"""Copy the two playable world maps from a read-only World_Map_History checkout.

No database, historical pipeline, or other year's files are copied. Geometry is
copied byte-for-byte; only shared attribute indexes are compacted to these maps.
"""

import argparse
import gzip
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCENARIOS = ("1939-09-01", "2026")


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f"Source template changed: expected one {old[:70]!r}")
    return text.replace(old, new, 1)


def copy_data(source):
    out = ROOT / "data"
    out.mkdir(exist_ok=True)
    snapshots = [json.loads((source / f"snap-{key}.json").read_text()) for key in SCENARIOS]
    admin = json.loads(gzip.decompress((source / "admin.bin").read_bytes()))
    aids = sorted({a for s in snapshots for a in s["admin_active"]})
    features = sorted({f for s in snapshots for f in s["feature"]})
    units = sorted({u for s in snapshots for u in s["units_active"]})
    amap, fmap, umap = ({old: new for new, old in enumerate(ids)} for ids in (aids, features, units))
    compact = {"n": len(aids), "tier_zh": admin["tier_zh"], "cols": {},
               "feature_admin": [amap[admin["feature_admin"][f]] for f in features]}
    for key in ("admin_id", "tier", "partial", "merged", "area", "label"):
        compact[key] = [admin[key][a] for a in aids]
    for key, col in admin["cols"].items():
        used = sorted({col["idx"][a] for a in aids})
        lookup = {old: new for new, old in enumerate(used)}
        compact["cols"][key] = {"lut": [col["lut"][i] for i in used],
                                "idx": [lookup[col["idx"][a]] for a in aids]}
    content = json.dumps(compact, ensure_ascii=False, separators=(",", ":")).encode()
    (out / "admin.bin").write_bytes(gzip.compress(content, compresslevel=9, mtime=0))
    for s in snapshots:
        s["feature"] = [fmap[f] for f in s["feature"]]
        s["geo_feature"] = [fmap[f] for f in s["geo_feature"]]
        s["admin_active"] = [amap[a] for a in s["admin_active"]]
        s["unit"] = [umap[u] if u >= 0 else u for u in s["unit"]]
        s["units_active"] = [umap[u] for u in s["units_active"]]
        for label in s["unit_labels"]:
            label[0] = umap[label[0]]
        write_json(out / f"snap-{s['snapshot']}.json", s)
        shutil.copy2(source / f"geo-{s['snapshot']}.bin", out)
    index = json.loads((source / "index.json").read_text())
    index["snapshots"] = [s for s in index["snapshots"] if s["snapshot"] in SCENARIOS]
    write_json(out / "index.json", index)
    for name in ("hydro.bin", "hydro-detail.bin"):
        shutil.copy2(source / name, out)
    for name in ("relief", "glyphs"):
        shutil.copytree(source / name, out / name, dirs_exist_ok=True)


def copy_frontend(maps):
    template = (maps / "template.html").read_text()
    style = re.search(r"<style>\n(.*?)</style>", template, re.S)
    script = re.search(r"<script>\n(.*?)</script>", template, re.S)
    css = style[1].replace("/*__MAPLIBRE_CSS__*/\n", "")
    css = replace_once(css, "grid-template-columns: repeat(5, 1fr)", "grid-template-columns: repeat(3, 1fr)")
    # The original bottom sheet covers the MapLibre navigation on phones.
    css += '''
@media (max-width: 760px) {
  .maplibregl-ctrl-bottom-right { top: 4px; bottom: auto; z-index: 3; }
  .detail { padding-right: 56px; }
  .detail .close { right: 44px; }
}
'''
    js = script[1]
    js = replace_once(js, 'const DEFAULT_SNAPSHOT = "__DEFAULT_SNAPSHOT__";',
                      'const SCENARIOS = ["1939-09-01", "2026"];\n'
                      'const DEFAULT_SNAPSHOT = document.documentElement.dataset.scenario || SCENARIOS[0];')
    js = replace_once(js, 'const MODES = ["bloc", "nation", "control", "density", "tier"];',
                      'const MODES = ["bloc", "nation", "control"];')
    js = re.sub(r'const DENSITY_STEPS = .*?;\nconst DENSITY_RAMP = .*?;\n', '', js)
    js = js.replace(', density: 0.66, tier: 0.6', '').replace(', density: 0.62, tier: 0.5', '')
    js = re.sub(r'function densityClass\(.*?\n}\n\n', '', js, flags=re.S)
    js = js.replace(', d: densityClass(sd.pop[k], sd.area[k])', '')
    start = js.index('  if (state.mode === "tier") return', js.index('function fillColor()'))
    end = js.index('\n}', start)
    js = js[:start] + '  return ["get", "col"];' + js[end:]
    start = js.index('  } else if (state.mode === "tier") {', js.index('function legend()'))
    end = js.index('\n}\n', start)
    js = js[:start] + '  }' + js[end:]
    start = js.index('let b64Only = false;')
    end = js.index('async function inflate(buf)', start)
    js = js[:start] + '''async function getBin(u) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(u + " " + r.status);
  const buf = await r.arrayBuffer();
  const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  return b[0] === 0x1f && b[1] === 0x8b ? inflate(buf) : buf;
}
''' + js[end:]
    js = js.replace('pako from the CDN', 'the bundled pako')
    js = js.replace('https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js', 'vendor/pako.min.js')
    js = replace_once(js, 'async function loadSnap(snap) {',
                      'async function loadSnap(snap) {\n  if (!SCENARIOS.includes(snap)) throw new Error("未知地图：" + snap);')
    js = replace_once(js, '  state.snap = snap; const sd = sdNow();',
                      '  state.snap = snap; const sd = sdNow();\n  $("loading").hidden = true;\n'
                      '  $("q").value = ""; $("results").replaceChildren();')
    js = js.replace('store.get("ww2-base")', 'store.get("2d-slg-map-base")')
    js = js.replace('store.set("ww2-base",', 'store.set("2d-slg-map-base",')
    js = replace_once(js, '  for (const s of index.snapshots) {',
                      '  index.snapshots = index.snapshots.filter((s) => SCENARIOS.includes(s.snapshot));\n'
                      '  for (const s of index.snapshots) {')
    js = js.replace('b.onclick = () => loadSnap(s.snapshot);', 'b.onclick = () => loadSnap(s.snapshot).catch(fail);')
    js = replace_once(js, 'for (const [ai, zh, nm, en] of names) {',
                      'for (const [ai, zh, nm, en] of names) { if (!live.has(ai)) continue;')
    start = js.index('function ensureLib() {')
    end = js.index('\nfunction fail(e)', start)
    js = js[:start] + '''function ensureLib() {
  if (!window.maplibregl) return fail(new Error("本地地图引擎载入失败"));
  return boot().catch(fail);
}''' + js[end:]
    body = template[template.index('<div class="app">'):template.index('<script src=')].strip()
    body = body.replace('世界省级历史地图 1900–1991', '世界地图 · 1939 / 2026')
    body = body.replace('1900–1991 十九个断面与 2026 年 · 省级区划 · 阵营、国家与实际控制区 · 重要城市',
                        '1939 与 2026 · 省级地块 · 阵营、国家与实际控制区')
    body = body.replace('aria-label="时间断面"', 'aria-label="地图年份"')
    body = re.sub(r'          <button[^\n]*data-mode="(?:density|tier)"[^\n]*\n', '', body)
    start = body.index('      <p class="foot">点击地图先选中国家')
    end = body.index('</p>', start) + 4
    body = body[:start] + ('      <p class="foot">点击地图先选中国家，再点击同一国家进入省级。'
                          '1939 地块固定为 1939-09-01；2026 使用原项目的当今世界数据。'
                          '斜线表示近似控制区，缺少省界的地区保留整个政治单元。'
                          '数据来源与许可见 <a href="docs/SOURCES.md">图源说明</a>。</p>') + body[end:]
    (ROOT / "styles.css").write_text(css)
    (ROOT / "app.js").write_text(js)
    for name, scenario in (("index.html", SCENARIOS[0]), ("1939-09-01.html", SCENARIOS[0]), ("2026.html", SCENARIOS[1])):
        (ROOT / name).write_text(f'''<!doctype html>
<html lang="zh-CN" data-scenario="{scenario}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>世界地图 · 1939 / 2026</title>
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="vendor/maplibre-gl.css">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
{body}
<script src="vendor/maplibre-gl.js"></script>
<script src="app.js"></script>
</body>
</html>
''')
    shutil.copytree(maps / "vendor", ROOT / "vendor", dirs_exist_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Local World_Map_History checkout (read only)")
    args = parser.parse_args()
    source = args.source.resolve()
    if source == ROOT or ROOT.is_relative_to(source) or source.is_relative_to(ROOT):
        parser.error("Source and destination must be separate repositories")
    maps = source / "ww2" / "maps"
    copy_data(maps / "data")
    copy_frontend(maps)
    commit = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    files = [maps / "template.html", *sorted((maps / "vendor").iterdir()),
             maps / "data" / "admin.bin", maps / "data" / "index.json",
             *(maps / "data" / f"{kind}-{s}.{ext}" for s in SCENARIOS
               for kind, ext in (("snap", "json"), ("geo", "bin")))]
    manifest = {"source": "https://github.com/dns0129/world_map_history", "commit": commit,
                "scenarios": list(SCENARIOS), "source_files": {
                    str(f.relative_to(source)): hashlib.sha256(f.read_bytes()).hexdigest() for f in files}}
    write_json(ROOT / "data" / "copy-manifest.json", manifest)
    print(f"Copied {', '.join(SCENARIOS)} from {commit}; source was read only.")


if __name__ == "__main__":
    main()
