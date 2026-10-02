"""Write ww2/maps/index.html and one page per snapshot from ww2/maps/template.html.

The MapLibre stylesheet is inlined (the published page may load styles only
from Google Fonts); the script is vendored and falls back to public CDNs.
Each per-date page opens on its own snapshot and can switch to the others.
"""
from ww2_common import SNAPSHOTS, WW2_OUT

MAPS = WW2_OUT / "maps"


def main():
    tpl = (MAPS / "template.html").read_text()
    css = (MAPS / "vendor" / "maplibre-gl.css").read_text()
    tpl = tpl.replace("/*__MAPLIBRE_CSS__*/", css)
    pages = [("index.html", "1942-11-01")] + [(f"{d}.html", d) for d, _, _ in SNAPSHOTS]
    for name, snap in pages:
        (MAPS / name).write_text(tpl.replace("__DEFAULT_SNAPSHOT__", snap))
        print(MAPS / name)


if __name__ == "__main__":
    main()
