"""Minimal TopoJSON helpers (no quantisation transform, absolute arcs)."""
import json

from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.ops import orient


def load(path, obj=None):
    d = json.load(open(path))
    obj = obj or next(iter(d["objects"]))
    return d["arcs"], d["objects"][obj]["geometries"]


def ring(arcs, idxs):
    pts = []
    for i in idxs:
        a = arcs[i] if i >= 0 else arcs[~i][::-1]
        pts.extend(a if not pts else a[1:])
    return pts


def to_shape(arcs, g):
    if g["type"] == "Polygon":
        polys = [g["arcs"]]
    elif g["type"] == "MultiPolygon":
        polys = g["arcs"]
    else:
        return None
    out = []
    for p in polys:
        rings = [ring(arcs, r) for r in p]
        rings = [r for r in rings if len(r) >= 4]
        if rings:
            out.append(Polygon(rings[0], rings[1:]))
    geom = MultiPolygon(out) if len(out) > 1 else out[0]
    if not geom.is_valid:
        geom = geom.buffer(0)
    return orient(geom) if geom.geom_type == "Polygon" else MultiPolygon([orient(p) for p in geom.geoms])


def simplify_arcs(arcs, tolerance, ndigits=4):
    """Simplify each shared arc once so neighbouring polygons keep identical
    borders (no slivers or gaps), keeping arc end points fixed."""
    out = []
    for a in arcs:
        if len(a) > 2 and tolerance > 0:
            s = list(LineString(a).simplify(tolerance, preserve_topology=False).coords)
            if len(s) < 2:
                s = [a[0], a[-1]]
            # closed rings need at least 4 points to stay polygons
            if a[0] == a[-1] and len(s) < 4:
                s = a if len(a) <= 4 else [a[0], a[len(a) // 3], a[2 * len(a) // 3], a[-1]]
        else:
            s = a
        out.append([[round(x, ndigits), round(y, ndigits)] for x, y in s])
    return out
