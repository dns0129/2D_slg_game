"""Write ww2/maps/index.html and one page per snapshot from ww2/maps/template.html.

The MapLibre stylesheet is inlined (the published page may load styles only
from Google Fonts); the script is vendored and falls back to public CDNs.
Each per-date page opens on its own snapshot and can switch to the others.
"""
import base64

from ww2_common import SNAPSHOTS, WW2_OUT, WW2_WORK

MAPS = WW2_OUT / "maps"


def main():
    tpl = (MAPS / "template.html").read_text()
    css = (MAPS / "vendor" / "maplibre-gl.css").read_text()
    tpl = tpl.replace("/*__MAPLIBRE_CSS__*/", css)
    head = ('<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n')
    pages = [("index.html", "1942-11-01")] + [(f"{d}.html", d) for d, _, _ in SNAPSHOTS]
    for name, snap in pages:
        body = tpl.replace("__DEFAULT_SNAPSHOT__", snap)
        (MAPS / name).write_text(head + body + "\n</html>\n")
        print(MAPS / name)
    # the artifact host supplies the document skeleton itself and serves only text and media types,
    # so the binary geometry goes along base64-encoded
    (WW2_WORK / "artifact_index.html").write_text(tpl.replace("__DEFAULT_SNAPSHOT__", "1942-11-01"))
    for name in ("geo", "geo-units"):
        raw = (MAPS / "data" / f"{name}.bin").read_bytes()
        (WW2_WORK / f"{name}.b64.txt").write_text(base64.b64encode(raw).decode())


if __name__ == "__main__":
    main()
