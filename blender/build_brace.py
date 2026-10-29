"""
Procedural Blender build of the Taylor's Brace (MAXheal orthotics) for the AR try-on.

Run headless:
    blender -b --factory-startup --python blender/build_brace.py -- [--no-render]

Outputs:
    blender/taylors_brace.blend        editable source scene (brace + validation mannequin + cameras)
    public/models/taylors_brace.glb    optimized web asset (brace + depth-only body occluder)
    blender/textures/*.png             generated fabric textures (embedded in the GLB)
    blender/renders/*.png              front / back / left / right / three-quarter validation renders

Reference photographs (reference/):
    01-box-worn-front   worn, front: open chest, padded shoulder straps, wide abdominal belt with velcro tab
    02-box-worn-back    worn, back: tall rear panel with two stays, padded scapular band with two centre
                        buckles, webbing straps running diagonally down/out (inverted V), lumbar bands
    03-product-flat-inner-elastic   striped navy/gray elastic belt with teal lines, upper overlay strap,
                        side velcro tabs
    04-product-flat-outer-rear      narrow upper panel with darker stays, triangular V-buckle on a webbing
                        tab, padded scapular band with waisted centre and teal piping

Conventions (Blender space, metres):
    +X = wearer's anatomical LEFT, -Y = wearer's FRONT, +Z = up.
    Origin = midpoint between the shoulder JOINT centres (what MediaPipe reports as shoulders).
    glTF export converts to +Y up / +Z front, so in three.js the brace faces +Z and +X is the wearer's left.
    Reference body: shoulder-joint width 0.36 m, shoulder-mid to hip-mid 0.50 m, hip-joint width 0.25 m.
"""

import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TEX_DIR = os.path.join(HERE, "textures")
RENDER_DIR = os.path.join(HERE, "renders")
GLB_PATH = os.path.join(ROOT, "public", "models", "taylors_brace.glb")
BLEND_PATH = os.path.join(HERE, "taylors_brace.blend")

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DO_RENDER = "--no-render" not in ARGS

# Reference body proportions; mirrored in src/model/braceConfig.js
REF = {"shoulder_width": 0.36, "torso_length": 0.50, "hip_width": 0.25}

# --------------------------------------------------------------------------------------------
# Reference torso: superelliptic cross-sections lofted along Z
# --------------------------------------------------------------------------------------------
#        z       half-width  front-depth  back-depth  centre-y
TORSO_KEYS = [
    (0.14, 0.060, 0.055, 0.050, 0.010),
    (0.08, 0.080, 0.062, 0.058, 0.012),
    (0.05, 0.125, 0.075, 0.072, 0.012),
    (0.02, 0.158, 0.088, 0.082, 0.010),
    (-0.04, 0.166, 0.105, 0.090, 0.006),
    (-0.12, 0.160, 0.118, 0.092, 0.000),
    (-0.22, 0.150, 0.114, 0.088, 0.000),
    (-0.32, 0.138, 0.102, 0.080, 0.004),
    (-0.40, 0.134, 0.100, 0.080, 0.008),
    (-0.48, 0.150, 0.100, 0.092, 0.010),
    (-0.56, 0.162, 0.098, 0.104, 0.012),
    (-0.64, 0.165, 0.095, 0.106, 0.012),
    (-0.80, 0.160, 0.090, 0.100, 0.012),
]
SUPER_N = 2.6
N_THETA = 360


def _catmull(keys, z):
    zs = [k[0] for k in keys]
    if z >= zs[0]:
        return np.array(keys[0][1:])
    if z <= zs[-1]:
        return np.array(keys[-1][1:])
    for i in range(len(zs) - 1):
        if zs[i] >= z >= zs[i + 1]:
            break
    p1, p2 = np.array(keys[i][1:]), np.array(keys[i + 1][1:])
    p0 = np.array(keys[max(i - 1, 0)][1:])
    p3 = np.array(keys[min(i + 2, len(keys) - 1)][1:])
    t = (zs[i] - z) / (zs[i] - zs[i + 1])
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


_section_cache = {}


def section(z):
    """Closed cross-section at height z: points (N,2), cumulative arc length, perimeter, back-centre s."""
    key = round(z, 4)
    if key in _section_cache:
        return _section_cache[key]
    a, bf, bb, yc = _catmull(TORSO_KEYS, z)
    th = np.linspace(0.0, 2 * math.pi, N_THETA + 1)
    s, c = np.sin(th), np.cos(th)
    e = 2.0 / SUPER_N
    x = a * np.sign(s) * np.abs(s) ** e
    y = np.where(c > 0, -bf * np.abs(c) ** e, bb * np.abs(c) ** e) + yc
    pts = np.stack([x, y], axis=1)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    perim = cum[-1]
    s_back = cum[N_THETA // 2]
    out = (pts, cum, perim, s_back, yc)
    _section_cache[key] = out
    return out


def _sec_point(z, s):
    pts, cum, perim, _, _ = section(z)
    s = s % perim
    i = int(np.searchsorted(cum, s) - 1)
    i = min(max(i, 0), N_THETA - 1)
    t = (s - cum[i]) / max(cum[i + 1] - cum[i], 1e-9)
    p = pts[i] * (1 - t) + pts[i + 1] * t
    return Vector((p[0], p[1], z))


def surf(s, z, off=0.0):
    """Point on the torso surface. s = arc length from FRONT centre, positive toward +X (wearer's left)."""
    p = _sec_point(z, s)
    ds, dz = 0.002, 0.002
    ts = _sec_point(z, s + ds) - _sec_point(z, s - ds)
    tz = _sec_point(z + dz, s) - _sec_point(z - dz, s)
    n = ts.cross(tz).normalized()
    _, _, _, _, yc = section(z)
    radial = Vector((p.x, p.y - yc, 0.0))
    if n.dot(radial) < 0:
        n = -n
    return p + n * off, n


def back_s(z, sb):
    """Convert 'arc length from BACK centre, + toward wearer's left' into front-based s."""
    _, _, _, s_back, _ = section(z)
    return s_back - sb


def surf_back(sb, z, off=0.0):
    return surf(back_s(z, sb), z, off)


# --------------------------------------------------------------------------------------------
# Textures (generated, small, tiling)
# --------------------------------------------------------------------------------------------
def hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])


PAL = {
    "panel": hexrgb("#6e7b86"),
    "panel_dark": hexrgb("#5a6672"),
    "stay": hexrgb("#4a5561"),
    "band_light": hexrgb("#76838e"),
    "band_dark": hexrgb("#47525e"),
    "teal": hexrgb("#3a8580"),
    "navy": hexrgb("#2b3549"),
    "elastic_gray": hexrgb("#636e7a"),
    "webbing": hexrgb("#505b67"),
    "velcro": hexrgb("#7c8892"),
    "buckle": hexrgb("#4c5058"),
    "buckle_black": hexrgb("#1d1f22"),
    "skin": hexrgb("#d9b8a0"),
}

rng = np.random.default_rng(7)


def fabric_noise(h, w, amp=0.035, weave=0.02):
    n = rng.normal(0, 1, (h, w))
    # cheap blur for fibre clumps
    n = (n + np.roll(n, 1, 0) + np.roll(n, 1, 1) + np.roll(n, -1, 0) + np.roll(n, -1, 1)) / 5.0
    yy, xx = np.mgrid[0:h, 0:w]
    wv = np.sin(xx * math.pi * 0.5) * np.sin(yy * math.pi * 0.5)
    return n * amp + wv * weave


def save_image(name, rgb):
    """rgb: (H, W, 3) floats in sRGB 0..1, row 0 = bottom (Blender convention)."""
    h, w, _ = rgb.shape
    img = bpy.data.images.get(name) or bpy.data.images.new(name, w, h, alpha=False)
    if img.size[0] != w or img.size[1] != h:
        img.scale(w, h)
    rgba = np.concatenate([np.clip(rgb, 0, 1), np.ones((h, w, 1))], axis=2).astype(np.float32)
    img.pixels.foreach_set(rgba.ravel())
    path = os.path.join(TEX_DIR, name + ".png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    img.pack()
    return img


def make_textures():
    os.makedirs(TEX_DIR, exist_ok=True)
    tex = {}

    # Padded strap / scapular band: U = across the strap, V = along it (tiles).
    w, h = 256, 128
    u = (np.arange(w) + 0.5) / w
    col = np.zeros((w, 3))
    for i, uu in enumerate(u):
        d = min(uu, 1 - uu)  # distance to nearest edge (0..0.5)
        if d < 0.035:
            c = PAL["teal"]
        elif d < 0.06:
            c = PAL["band_light"] * 0.85
        elif d < 0.30:
            c = PAL["band_light"]
        else:
            c = PAL["band_dark"]
        col[i] = c
    rgb = np.repeat(col[None, :, :], h, axis=0)
    rgb = rgb + fabric_noise(h, w)[..., None]
    tex["strap"] = save_image("T_PaddedStrap", rgb)

    # Elastic abdominal belt: U = across belt height (0 bottom .. 1 top), V = along (tiles).
    w, h = 512, 64
    u = (np.arange(w) + 0.5) / w
    col = np.zeros((w, 3))
    n_stripes = 16
    for i, uu in enumerate(u):
        k = int(uu * n_stripes)
        c = PAL["navy"] if k % 2 == 0 else PAL["elastic_gray"]
        f = (uu * n_stripes) % 1.0
        if f < 0.08 or f > 0.92:
            c = c * 0.9
        # teal lines near both edges and through the middle, as on the product
        for tl in (0.035, 0.5, 0.965):
            if abs(uu - tl) < 0.008:
                c = PAL["teal"]
        col[i] = c
    rgb = np.repeat(col[None, :, :], h, axis=0)
    yy = np.arange(h)[:, None, None]
    rgb = rgb * (1 + 0.04 * np.sin(yy * math.pi))  # knit ribs
    rgb = rgb + fabric_noise(h, w, amp=0.02, weave=0.0)[..., None]
    tex["elastic"] = save_image("T_ElasticBelt", rgb)

    # Panel fabric (tiling).
    w = h = 256
    rgb = np.ones((h, w, 3)) * PAL["panel"] + fabric_noise(h, w, amp=0.03, weave=0.025)[..., None]
    tex["panel"] = save_image("T_PanelFabric", rgb)

    # Webbing: twill diagonals, darker selvedge. U across, V along.
    w, h = 64, 128
    yy, xx = np.mgrid[0:h, 0:w]
    tw = ((xx + yy) % 6 < 3).astype(float) * 0.05 - 0.025
    rgb = np.ones((h, w, 3)) * PAL["webbing"] + tw[..., None]
    edge = (np.minimum(xx, w - 1 - xx) < 3)[..., None]
    rgb = np.where(edge, rgb * 0.85, rgb)
    tex["webbing"] = save_image("T_Webbing", rgb)

    # Velcro loop fabric.
    w = h = 128
    rgb = np.ones((h, w, 3)) * PAL["velcro"] + fabric_noise(h, w, amp=0.06, weave=0.0)[..., None]
    tex["velcro"] = save_image("T_Velcro", rgb)
    return tex


# --------------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------------
def make_material(name, color=None, image=None, rough=0.9, metal=0.0, sheen=0.25):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if "Sheen Weight" in bsdf.inputs:
        bsdf.inputs["Sheen Weight"].default_value = sheen
    if image is not None:
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = image
        tn.location = (-400, 200)
        nt.links.new(tn.outputs["Color"], bsdf.inputs["Base Color"])
    elif color is not None:
        lin = [c ** 2.2 for c in color]
        bsdf.inputs["Base Color"].default_value = (*lin, 1.0)
        mat.diffuse_color = (*lin, 1.0)
    return mat


# --------------------------------------------------------------------------------------------
# Mesh builders
# --------------------------------------------------------------------------------------------
def new_object(name, bm, mats, collection, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    collection.objects.link(ob)
    return ob


def smoothstep(e0, e1, x):
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def build_patch(name, coll, mat, s_range, z_lo, z_hi, off, thick, ns=48, nz=16,
                frame="back", uv="tile", uv_scale=(0.12, 0.12), pillow=0.0, off_fn=None):
    """
    Thick fabric patch that follows the torso surface.
    s_range: (s0, s1) in 'back' (from back centre) or 'front' (from front centre) arc-length coords.
    z_lo / z_hi: callables s -> z giving the column extent (lets us cut steps, notches, rounded corners).
    off: base offset from the skin; thick: material thickness; pillow: edge round-off distance (padding).
    uv: 'tile' (metres / uv_scale) or 'across_z' (U = 0..1 across the column height, V along s).
    """
    s0, s1 = s_range
    to_pt = surf_back if frame == "back" else surf
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    outer, inner, uvs = [], [], []
    for i in range(ns + 1):
        s = s0 + (s1 - s0) * i / ns
        zl, zh = z_lo(s), z_hi(s)
        o_row, i_row, uv_row = [], [], []
        base = off + (off_fn(s) if off_fn else 0.0)
        for j in range(nz + 1):
            z = zl + (zh - zl) * j / nz
            t = thick
            if pillow > 0:
                d = min(abs(s - s0), abs(s1 - s), abs(z - zl), abs(zh - z))
                t = thick * (0.35 + 0.65 * smoothstep(0.0, pillow, d))
            po, _ = to_pt(s, z, base + t)
            pi, _ = to_pt(s, z, base)
            o_row.append(bm.verts.new(po))
            i_row.append(bm.verts.new(pi))
            if uv == "across_z":
                uv_row.append(((j / nz), (s - s0) / uv_scale[1]))
            else:
                uv_row.append(((s - s0) / uv_scale[0], (z - zl) / uv_scale[1]))
        outer.append(o_row)
        inner.append(i_row)
        uvs.append(uv_row)

    def face(vs, uvc):
        f = bm.faces.new(vs)
        for loop, c in zip(f.loops, uvc):
            loop[uv_layer].uv = c
        return f

    # In 'back' frame +s runs toward -s_front, so winding flips; fix afterwards with normal recalc.
    for i in range(ns):
        for j in range(nz):
            face([outer[i][j], outer[i + 1][j], outer[i + 1][j + 1], outer[i][j + 1]],
                 [uvs[i][j], uvs[i + 1][j], uvs[i + 1][j + 1], uvs[i][j + 1]])
            face([inner[i][j + 1], inner[i + 1][j + 1], inner[i + 1][j], inner[i][j]],
                 [uvs[i][j + 1], uvs[i + 1][j + 1], uvs[i + 1][j], uvs[i][j]])
    for i in range(ns):  # bottom and top rims
        for j in (0, nz):
            a, b = (outer[i][j], outer[i + 1][j]), (inner[i + 1][j], inner[i][j])
            face([a[0], a[1], b[0], b[1]], [uvs[i][j], uvs[i + 1][j], uvs[i + 1][j], uvs[i][j]])
    for i in (0, ns):  # side rims
        for j in range(nz):
            face([outer[i][j], outer[i][j + 1], inner[i][j + 1], inner[i][j]],
                 [uvs[i][j], uvs[i][j + 1], uvs[i][j + 1], uvs[i][j]])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object(name, bm, [mat], coll)


def rounded_range(s0, s1, z0, z1, r_top=0.0, r_bot=0.0):
    """Column extent functions for a rounded rectangle in (s, z) space."""
    def end_dist(s):
        return min(s - s0, s1 - s)

    def lo(s):
        d = end_dist(s)
        if r_bot > 0 and d < r_bot:
            return z0 + r_bot - math.sqrt(max(r_bot ** 2 - (r_bot - d) ** 2, 0.0))
        return z0

    def hi(s):
        d = end_dist(s)
        if r_top > 0 and d < r_top:
            return z1 - (r_top - math.sqrt(max(r_top ** 2 - (r_top - d) ** 2, 0.0)))
        return z1
    return lo, hi


def catmull_path(points, spacing=0.005):
    pts = [Vector(p) for p in points]
    ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    dense = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        n = max(int((p2 - p1).length / spacing), 2)
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            dense.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                                + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    dense.append(pts[-1])
    return dense


def build_sweep(name, coll, mat, path, normals, width, thick, profile="strap", segs=10,
                uv_len=0.15, closed=False, caps=True):
    """
    Sweep a cross-section along a dense path. normals[i] is the 'away from body' hint at path[i]
    (the strap's flat face lies against the body). profile: 'strap' (pillowed flat) or 'tube'.
    """
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    if profile == "tube":
        ring = [(math.cos(a) * width, math.sin(a) * width, a / (2 * math.pi))
                for a in np.linspace(0, 2 * math.pi, segs, endpoint=False)]
    else:
        top = []
        for k in range(segs + 1):
            w = -width / 2 + width * k / segs
            d = min(w + width / 2, width / 2 - w)
            t = thick * (0.45 + 0.55 * smoothstep(0, width * 0.22, d)) if profile == "strap" else thick
            top.append((w, t, k / segs))
        bot = [(w, 0.0, u) for (w, _, u) in reversed(top)]
        ring = top + bot
    rings, length = [], 0.0
    prev = None
    for i, p in enumerate(path):
        if i == 0:
            tng = (path[1] - path[0]).normalized()
        elif i == len(path) - 1:
            tng = (path[-1] - path[-2]).normalized()
        else:
            tng = (path[i + 1] - path[i - 1]).normalized()
        n = Vector(normals[i])
        n = (n - tng * n.dot(tng)).normalized()
        b = tng.cross(n)
        if prev is not None:
            length += (p - prev).length
        prev = p
        rings.append([(bm.verts.new(p + b * w + n * t), u, length / uv_len) for (w, t, u) in ring])
    m = len(ring)
    last = len(rings) - 1 if not closed else len(rings)
    for i in range(last):
        r0, r1 = rings[i], rings[(i + 1) % len(rings)]
        for k in range(m):
            kk = (k + 1) % m
            try:
                f = bm.faces.new([r0[k][0], r0[kk][0], r1[kk][0], r1[k][0]])
            except ValueError:
                continue
            uk, ukk = r0[k][1], r0[kk][1]
            if profile == "tube" and kk == 0:
                ukk = 1.0
            for loop, c in zip(f.loops, [(uk, r0[k][2]), (ukk, r0[kk][2]), (ukk, r1[kk][2]), (uk, r1[k][2])]):
                loop[uv_layer].uv = c
    if caps and not closed:
        for r in (rings[0], rings[-1]):
            try:
                f = bm.faces.new([v for (v, _, _) in r])
                for loop in f.loops:
                    loop[uv_layer].uv = (0.5, 0.5)
            except ValueError:
                pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object(name, bm, [mat], coll)


def surface_path(points_sz, off, frame="back", spacing=0.006):
    """Densely sample a polyline given in (s, z) surface coords; returns (points, normals)."""
    to_pt = surf_back if frame == "back" else surf
    out_p, out_n = [], []
    for (sa, za, oa), (sb, zb, ob) in zip(points_sz[:-1], points_sz[1:]):
        pa, _ = to_pt(sa, za, 0)
        pb, _ = to_pt(sb, zb, 0)
        n = max(int((pb - pa).length / spacing), 1)
        for k in range(n):
            t = k / n
            s, z, o = sa + (sb - sa) * t, za + (zb - za) * t, oa + (ob - oa) * t
            p, nn = to_pt(s, z, off + o)
            out_p.append(p)
            out_n.append(nn)
    s, z, o = points_sz[-1]
    p, nn = to_pt(s, z, off + o)
    out_p.append(p)
    out_n.append(nn)
    return out_p, out_n


def build_extrusion(name, coll, mat, outline_sz, center_sz, off, depth, frame="back"):
    """Flat plastic part: 2D outline (ds, dz) around a surface anchor, extruded along the surface normal."""
    to_pt = surf_back if frame == "back" else surf
    cs, cz = center_sz
    _, n = to_pt(cs, cz, 0)
    bm = bmesh.new()
    bot = [bm.verts.new(to_pt(cs + ds, cz + dz, off)[0]) for (ds, dz) in outline_sz]
    top = [bm.verts.new(v.co + n * depth) for v in bot]
    bm.faces.new(bot)
    bm.faces.new(list(reversed(top)))
    k = len(bot)
    for i in range(k):
        bm.faces.new([bot[i], bot[(i + 1) % k], top[(i + 1) % k], top[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object(name, bm, [mat], coll, smooth=False)


def build_frame(name, coll, mat, center_sz, w, h, bar, off, depth, frame="back"):
    """Rectangular slide buckle: 4 bars around an opening."""
    cs, cz = center_sz
    parts = []
    for (ds, dz, ww, hh) in [(0, h / 2 - bar / 2, w, bar), (0, -h / 2 + bar / 2, w, bar),
                             (-w / 2 + bar / 2, 0, bar, h), (w / 2 - bar / 2, 0, bar, h),
                             (0, 0, w * 0.9, bar * 0.8)]:
        outline = [(ds - ww / 2, dz - hh / 2), (ds + ww / 2, dz - hh / 2),
                   (ds + ww / 2, dz + hh / 2), (ds - ww / 2, dz + hh / 2)]
        parts.append(build_extrusion(name + "_p", coll, mat, outline, (cs, cz), off, depth, frame))
    return join_objects(parts, name)


def join_objects(objs, name):
    ctx = bpy.context
    for o in ctx.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    ctx.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = ctx.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def mirror_copy(ob, name):
    me = ob.data.copy()
    me.name = name
    for v in me.vertices:
        v.co.x = -v.co.x
    me.flip_normals()
    new = bpy.data.objects.new(name, me)
    for c in ob.users_collection:
        c.objects.link(new)
    return new


# --------------------------------------------------------------------------------------------
# The brace
# --------------------------------------------------------------------------------------------
# Key heights (z, metres from shoulder-joint line)
Z_PANEL_TOP = 0.055        # rear panel top, just below C7
Z_STEP = -0.245            # narrow thoracic section widens into the lumbar section
Z_PANEL_BOT = -0.585       # rear panel bottom, over the sacrum
UPPER_HALF = 0.100         # half-width of the thoracic section (arc length)
LOWER_HALF = 0.170         # half-width of the lumbar section
Z_BAND_TOP, Z_BAND_BOT = -0.150, -0.222   # padded scapular band
BAND_HALF = 0.215
Z_BELT_TOP, Z_BELT_BOT = -0.330, -0.555   # abdominal elastic belt
Z_UBELT_TOP, Z_UBELT_BOT = -0.315, -0.400  # upper overlay strap

OFF_SKIN = 0.004
T_PANEL = 0.010
T_BELT = 0.005


def panel_extent():
    r_top, r_step = 0.030, 0.018

    def hi(s):
        a = abs(s)
        if a <= UPPER_HALF:
            d = UPPER_HALF - a
            if d < r_top:
                return Z_PANEL_TOP - (r_top - math.sqrt(max(r_top ** 2 - (r_top - d) ** 2, 0)))
            return Z_PANEL_TOP
        # shoulder of the step: small concave fillet then the lumbar section's top edge
        d = a - UPPER_HALF
        if d < r_step:
            return Z_STEP + r_step - math.sqrt(max(r_step ** 2 - (r_step - d) ** 2, 0))
        e = LOWER_HALF - a
        r = 0.02
        if e < r:
            return Z_STEP - (r - math.sqrt(max(r ** 2 - (r - e) ** 2, 0)))
        return Z_STEP

    def lo(s):
        e = LOWER_HALF - abs(s)
        r = 0.02
        if e < r:
            return Z_PANEL_BOT + (r - math.sqrt(max(r ** 2 - (r - e) ** 2, 0)))
        return Z_PANEL_BOT
    return lo, hi


def panel_outline(lo, hi, n=120):
    """Closed outline polyline of the rear panel in (sb, z)."""
    ss = np.linspace(-LOWER_HALF, LOWER_HALF, n)
    top = [(s, hi(s)) for s in ss]
    bot = [(s, lo(s)) for s in reversed(ss)]
    return top + bot + [top[0]]


def build_brace(coll, mats):
    parts = {}

    # 1. Rear support panel (stepped: narrow thoracic upper, wide lumbar lower)
    lo, hi = panel_extent()
    lumbar_off = lambda s: T_BELT + 0.001  # lumbar part sits over the elastic belt  # noqa: E731

    def panel_off(s):
        return 0.0

    parts["RearPanel"] = build_patch("RearPanel", coll, mats["panel"], (-LOWER_HALF, LOWER_HALF),
                                     lo, hi, OFF_SKIN + T_BELT + 0.001, T_PANEL, ns=96, nz=48,
                                     uv="tile", uv_scale=(0.1, 0.1), pillow=0.01, off_fn=panel_off)

    # Teal piping round the panel edge
    outline = panel_outline(lo, hi)
    pp, pn = surface_path([(s, z, 0) for (s, z) in outline], OFF_SKIN + T_BELT + 0.001 + T_PANEL * 0.45,
                          spacing=0.006)
    parts["RearPanel_Piping"] = build_sweep("RearPanel_Piping", coll, mats["teal"], pp, pn, 0.0032, 0,
                                            profile="tube", segs=6)

    # 2. Two darker vertical stays (photo 2 + photo 4), full height
    for side, sx in (("L", 0.062), ("R", -0.062)):
        slo, shi = rounded_range(sx - 0.018, sx + 0.018, Z_PANEL_BOT + 0.03, Z_PANEL_TOP - 0.02, 0.01, 0.01)
        parts[f"Stay_{side}"] = build_patch(f"Stay_{side}", coll, mats["stay"], (sx - 0.018, sx + 0.018),
                                            slo, shi, OFF_SKIN + T_BELT + 0.001 + T_PANEL * 0.75, 0.004,
                                            ns=6, nz=60, uv="tile", uv_scale=(0.1, 0.1), pillow=0.006)

    # 3. Lumbar reinforcement bands (photo 2: horizontal bands at top and bottom of lumbar section)
    for nm, z0, z1 in (("LumbarBand_Upper", Z_STEP - 0.045, Z_STEP - 0.005),
                       ("LumbarBand_Lower", Z_PANEL_BOT + 0.012, Z_PANEL_BOT + 0.055)):
        blo, bhi = rounded_range(-LOWER_HALF + 0.004, LOWER_HALF - 0.004, z0, z1, 0.01, 0.01)
        parts[nm] = build_patch(nm, coll, mats["stay"], (-LOWER_HALF + 0.004, LOWER_HALF - 0.004), blo, bhi,
                                OFF_SKIN + T_BELT + 0.001 + T_PANEL * 0.9, 0.004, ns=60, nz=6,
                                uv="tile", uv_scale=(0.1, 0.1), pillow=0.006)

    # 4. Triangular V-buckle on a webbing tab, upper centre of the panel (photo 4)
    o_panel_top = OFF_SKIN + T_BELT + 0.001 + T_PANEL
    tlo, thi = rounded_range(-0.014, 0.014, -0.045, 0.030, 0.003, 0.003)
    parts["VBuckle_Tab"] = build_patch("VBuckle_Tab", coll, mats["webbing"], (-0.014, 0.014), tlo, thi,
                                       o_panel_top - 0.002, 0.003, ns=4, nz=12, uv="across_z",
                                       uv_scale=(1, 0.1))
    tri = [(-0.030, 0.0), (0.030, 0.0), (0.004, -0.058), (-0.004, -0.058)]
    parts["VBuckle"] = build_extrusion("VBuckle", coll, mats["buckle"], tri, (0.0, -0.030),
                                       o_panel_top + 0.0005, 0.005)
    slot = [(-0.019, -0.008), (-0.013, -0.008), (0.0, -0.040), (0.013, -0.008), (0.019, -0.008),
            (0.002, -0.050), (-0.002, -0.050)]
    parts["VBuckle_Slot"] = build_extrusion("VBuckle_Slot", coll, mats["buckle_black"], slot, (0.0, -0.030),
                                            o_panel_top + 0.0052, 0.0008)

    # 5. Padded scapular band with waisted centre (photo 4) carrying the strap anchors
    def bump(s):
        return math.exp(-(s / 0.055) ** 2)

    def band_hi(s):
        e = BAND_HALF - abs(s)
        r = 0.022
        z = Z_BAND_TOP - 0.022 * bump(s)
        if e < r:
            z -= r - math.sqrt(max(r ** 2 - (r - e) ** 2, 0))
        return z

    def band_lo(s):
        e = BAND_HALF - abs(s)
        r = 0.022
        z = Z_BAND_BOT + 0.018 * bump(s)
        if e < r:
            z += r - math.sqrt(max(r ** 2 - (r - e) ** 2, 0))
        return z
    o_band = OFF_SKIN + T_BELT + 0.001 + T_PANEL + 0.001
    parts["ScapularBand"] = build_patch("ScapularBand", coll, mats["strap"], (-BAND_HALF, BAND_HALF),
                                        band_lo, band_hi, o_band, 0.013, ns=90, nz=14, uv="across_z",
                                        uv_scale=(1, 0.12), pillow=0.012)

    # 6. Two black slide buckles at the band centre (photo 2)
    o_band_top = o_band + 0.013
    for side, sx in (("L", 0.024), ("R", -0.024)):
        parts[f"CentreBuckle_{side}"] = build_frame(f"CentreBuckle_{side}", coll, mats["buckle_black"],
                                                    (sx, -0.190), 0.030, 0.024, 0.0045, o_band_top - 0.002,
                                                    0.0035)

    # 7. Webbing straps from the centre buckles diagonally down and out (inverted V, photo 2)
    for side, sgn in (("L", 1), ("R", -1)):
        pts = [(sgn * 0.024, -0.196, 0.011), (sgn * 0.06, -0.24, 0.008), (sgn * 0.12, -0.38, 0.004),
               (sgn * 0.175, -0.505, 0.002), (sgn * 0.215, -0.525, -0.004)]
        pp, pn = surface_path(pts, OFF_SKIN + T_BELT + 0.001 + T_PANEL + 0.001, spacing=0.008)
        pp = catmull_path(pp[::3] + [pp[-1]], spacing=0.006)
        _, pn = zip(*[(None, surf_back_normal_near(p)) for p in pp])
        parts[f"DiagonalStrap_{side}"] = build_sweep(f"DiagonalStrap_{side}", coll, mats["webbing"], pp, pn,
                                                     0.034, 0.0025, profile="flat", segs=4, uv_len=0.08)

    # 8. Padded shoulder straps: panel top -> over the shoulder -> down the front -> under the arm ->
    #    back to the ends of the scapular band (photos 1 + 2)
    for side, sgn in (("L", 1), ("R", -1)):
        p_start, n_start = surf_back(sgn * 0.072, Z_PANEL_TOP - 0.03, o_panel_top)
        p_end2, n_end2 = surf_back(sgn * (BAND_HALF - 0.03), -0.187, o_band_top)
        p_end, n_end = surf_back(sgn * (BAND_HALF - 0.075), -0.187, o_band_top)
        ctrl = [
            (p_start, n_start),
            (Vector((sgn * 0.110, 0.070, 0.085)), Vector((sgn * 0.15, 0.65, 0.75))),
            (Vector((sgn * 0.138, 0.006, 0.096)), Vector((sgn * 0.2, 0.0, 1.0))),
            (Vector((sgn * 0.148, -0.070, 0.045)), Vector((sgn * 0.30, -0.80, 0.50))),
            (Vector((sgn * 0.150, -0.084, -0.045)), Vector((sgn * 0.40, -0.92, 0.0))),
            (Vector((sgn * 0.170, -0.055, -0.135)), Vector((sgn * 0.85, -0.40, -0.30))),
            (Vector((sgn * 0.180, 0.035, -0.170)), Vector((sgn * 0.9, 0.35, -0.2))),
            (Vector((sgn * 0.150, 0.090, -0.186)), Vector((sgn * 0.6, 0.8, 0.0))),
            (p_end2, n_end2),
            (p_end, n_end),
        ]
        path = catmull_path([c[0] for c in ctrl], spacing=0.005)
        normals = interp_normals(path, ctrl)
        parts[f"ShoulderStrap_{side}"] = build_sweep(f"ShoulderStrap_{side}", coll, mats["strap"], path,
                                                     normals, 0.062, 0.013, profile="strap", segs=12,
                                                     uv_len=0.12)

    # 9. Abdominal elastic belt: wraps the waist, inner wing from the right crosses the front, outer wing
    #    from the wearer's left overlaps it and closes with a velcro tab (photos 1 + 3)
    perim = section((Z_BELT_TOP + Z_BELT_BOT) / 2)[2]
    s_inner_end = 0.20
    total = perim + (s_inner_end - 0.055)

    def belt_s(i, n):
        return s_inner_end - total * i / n

    belt = build_belt("AbdominalBelt", coll, mats["elastic"], s_inner_end, total, Z_BELT_BOT, Z_BELT_TOP,
                      OFF_SKIN, T_BELT, perim)
    parts["AbdominalBelt"] = belt

    # Front velcro closure tab on the outer wing end (photo 1: lighter tab, rounded end toward centre)
    o_outer = OFF_SKIN + T_BELT * 2 + 0.002
    vlo, vhi = rounded_range(0.050, 0.150, -0.505, -0.375, 0.0, 0.0)

    def tab_lo(s):
        d = s - 0.050
        r = 0.045
        if d < r:
            return -0.440 - math.sqrt(max(r ** 2 - (r - d) ** 2, 0))
        return -0.485

    def tab_hi(s):
        d = s - 0.050
        r = 0.045
        if d < r:
            return -0.440 + math.sqrt(max(r ** 2 - (r - d) ** 2, 0))
        return -0.395
    parts["FrontClosureTab"] = build_patch("FrontClosureTab", coll, mats["velcro"], (0.050, 0.150), tab_lo,
                                           tab_hi, o_outer + T_BELT, 0.003, ns=24, nz=10, frame="front",
                                           uv="tile", uv_scale=(0.06, 0.06), pillow=0.004)

    # 10. Upper overlay strap (photo 3 upper striped band; photo 1 upper belt layer) with small velcro tab
    ub = build_belt("UpperTorsoBelt", coll, mats["elastic"], 0.15, perim + 0.10, Z_UBELT_BOT, Z_UBELT_TOP,
                    OFF_SKIN + T_BELT + 0.0015, 0.004, perim, stripe_scale=0.5)
    parts["UpperTorsoBelt"] = ub
    ulo, uhi = rounded_range(0.03, 0.10, Z_UBELT_BOT + 0.015, Z_UBELT_TOP - 0.015, 0.01, 0.01)
    parts["UpperClosureTab"] = build_patch("UpperClosureTab", coll, mats["velcro"], (0.03, 0.10), ulo, uhi,
                                           OFF_SKIN + T_BELT * 2 + 0.0065, 0.0025, ns=12, nz=6,
                                           frame="front", uv="tile", uv_scale=(0.06, 0.06))

    # 11. Adjustable side velcro straps on the belt sides (photo 3 hanging tabs)
    for side, sgn in (("L", 1), ("R", -1)):
        sx = sgn * (LOWER_HALF + 0.035)
        slo, shi = rounded_range(sx - 0.017, sx + 0.017, -0.535, -0.37, 0.012, 0.004)
        parts[f"SideStrap_{side}"] = build_patch(f"SideStrap_{side}", coll, mats["velcro"],
                                                 (sx - 0.017, sx + 0.017), slo, shi,
                                                 OFF_SKIN + T_BELT + 0.0012, 0.003, ns=6, nz=24,
                                                 uv="tile", uv_scale=(0.06, 0.06))
    return parts


def build_belt(name, coll, mat, s_start, total, z0, z1, off, thick, perim, stripe_scale=1.0):
    """Wrap-around belt as a slow spiral so the overlapping wing rides on top of the inner one."""
    ns, nz = 220, 10
    rise_start, rise_end = perim - 0.08, perim - 0.02

    def off_fn_len(L):
        return (thick + 0.0015) * smoothstep(rise_start, rise_end, L)

    # Build in 'front' frame with s decreasing (toward the wearer's right) from s_start.
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    outer, inner = [], []
    for i in range(ns + 1):
        L = total * i / ns
        s = s_start - L
        # gentle taper on both wing ends
        end_d = min(L, total - L)
        taper = 0.012 * (1 - smoothstep(0, 0.03, end_d))
        o_row, i_row = [], []
        for j in range(nz + 1):
            z = (z0 + taper) + ((z1 - taper) - (z0 + taper)) * j / nz
            base = off + off_fn_len(L)
            o_row.append((bm.verts.new(surf(s, z, base + thick)[0]), (j / nz, L / 0.1)))
            i_row.append((bm.verts.new(surf(s, z, base)[0]), (j / nz, L / 0.1)))
        outer.append(o_row)
        inner.append(i_row)

    def face(items):
        f = bm.faces.new([v for v, _ in items])
        for loop, (_, uv) in zip(f.loops, items):
            loop[uv_layer].uv = uv
    for i in range(ns):
        for j in range(nz):
            face([outer[i][j], outer[i + 1][j], outer[i + 1][j + 1], outer[i][j + 1]])
            face([inner[i][j + 1], inner[i + 1][j + 1], inner[i + 1][j], inner[i][j]])
        for j in (0, nz):
            face([outer[i][j], outer[i + 1][j], inner[i + 1][j], inner[i][j]])
    for i in (0, ns):
        for j in range(nz):
            face([outer[i][j], outer[i][j + 1], inner[i][j + 1], inner[i][j]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object(name, bm, [mat], coll)


def surf_back_normal_near(p):
    """Outward body normal at the surface point nearest (radially) to p."""
    _, _, _, _, yc = section(p.z)
    r = Vector((p.x, p.y - yc, 0))
    # small sample search over s for the closest surface point at this height
    pts, cum, perim, _, _ = section(p.z)
    d = np.linalg.norm(pts - np.array([p.x, p.y]), axis=1)
    i = int(np.argmin(d))
    _, n = surf(cum[i], p.z, 0)
    return n if n.dot(r) >= 0 else -n


def interp_normals(path, ctrl):
    """Assign each dense path point the normal of its nearest control points, blended by distance."""
    cps = [c[0] for c in ctrl]
    cns = [c[1].normalized() for c in ctrl]
    out = []
    for p in path:
        d = [(p - c).length for c in cps]
        i = int(np.argmin(d))
        j = i + 1 if i + 1 < len(cps) and (i == 0 or d[i + 1] < d[i - 1]) else i - 1
        di, dj = d[i], d[j]
        w = dj / (di + dj + 1e-9)
        out.append((cns[i] * w + cns[j] * (1 - w)).normalized())
    return out


# --------------------------------------------------------------------------------------------
# Body: validation mannequin (not exported) + depth-only occluder (exported)
# --------------------------------------------------------------------------------------------
def build_loft(name, coll, mat, z_top, z_bot, shrink=0.0, nz=60, nth=48, cap=True):
    bm = bmesh.new()
    rows = []
    for j in range(nz + 1):
        z = z_top + (z_bot - z_top) * j / nz
        perim = section(z)[2]
        row = [bm.verts.new(surf(perim * k / nth, z, -shrink)[0]) for k in range(nth)]
        rows.append(row)
    for j in range(nz):
        for k in range(nth):
            bm.faces.new([rows[j][k], rows[j][(k + 1) % nth], rows[j + 1][(k + 1) % nth], rows[j + 1][k]])
    if cap:
        bm.faces.new(rows[0])
        bm.faces.new(list(reversed(rows[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object(name, bm, [mat], coll)


def build_capsule(name, coll, mat, a, b, r):
    bm = bmesh.new()
    a, b = Vector(a), Vector(b)
    d = b - a
    bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=r)
    for v in bm.verts:
        # stretch the sphere into a capsule along +Z then orient
        if v.co.z > 0:
            v.co.z += d.length
    ob = new_object(name, bm, [mat], coll)
    ob.location = a
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return ob


def build_mannequin(coll, mat):
    objs = [build_loft("M_Torso", coll, mat, 0.14, -0.80, shrink=0.0)]
    objs.append(build_capsule("M_Neck", coll, mat, (0, 0.012, 0.10), (0, 0.0, 0.22), 0.055))
    head = build_capsule("M_Head", coll, mat, (0, -0.01, 0.30), (0, -0.01, 0.36), 0.095)
    objs.append(head)
    for sgn in (1, -1):
        objs.append(build_capsule("M_Deltoid", coll, mat, (sgn * 0.175, 0.0, 0.0), (sgn * 0.178, 0.0, 0.01), 0.058))
        objs.append(build_capsule("M_UpperArm", coll, mat, (sgn * 0.185, 0.0, -0.01),
                                  (sgn * 0.27, 0.0, -0.29), 0.045))
        objs.append(build_capsule("M_Forearm", coll, mat, (sgn * 0.27, 0.0, -0.29),
                                  (sgn * 0.33, -0.04, -0.54), 0.036))
    return objs


# --------------------------------------------------------------------------------------------
# Scene: validation cameras, lights, renders, export
# --------------------------------------------------------------------------------------------
def setup_validation(scene):
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.80, 0.81, 0.82, 1)
        bg.inputs[1].default_value = 0.22

    def light(name, loc, energy, size=2.0):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = energy
        ld.size = size
        ob = bpy.data.objects.new(name, ld)
        ob.location = loc
        d = Vector((0, 0, -0.25)) - Vector(loc)
        ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(ob)
    light("Key", (1.6, -2.2, 1.4), 150)
    light("Fill", (-2.0, -1.2, 0.6), 60)
    light("Rim", (0.4, 2.6, 1.2), 140)
    light("BackFill", (-1.2, 2.4, 0.2), 70)

    cams = {}
    views = {
        "front": ((0, -3, -0.25), True),
        "back": ((0, 3, -0.25), True),
        "left": ((3, 0, -0.25), True),
        "right": ((-3, 0, -0.25), True),
        "three_quarter": ((1.9, -2.2, 0.35), False),
        "three_quarter_back": ((-1.9, 2.2, 0.35), False),
    }
    for name, (loc, ortho) in views.items():
        cd = bpy.data.cameras.new("Cam_" + name)
        if ortho:
            cd.type = "ORTHO"
            cd.ortho_scale = 1.05
        else:
            cd.lens = 70
        ob = bpy.data.objects.new("Cam_" + name, cd)
        ob.location = loc
        d = Vector((0, 0, -0.25)) - Vector(loc)
        ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(ob)
        cams[name] = ob
    return cams


def render_views(scene, cams):
    os.makedirs(RENDER_DIR, exist_ok=True)
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else (
        "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_WORKBENCH")
    scene.render.resolution_x = 720
    scene.render.resolution_y = 900
    scene.render.film_transparent = False
    try:
        scene.view_settings.view_transform = "Standard"
    except TypeError:
        pass
    for name, cam in cams.items():
        scene.camera = cam
        scene.render.filepath = os.path.join(RENDER_DIR, f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print("[brace] rendered", name)


def export_glb(brace_coll, occluder):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in brace_coll.objects:
        o.select_set(True)
    occluder.select_set(True)
    os.makedirs(os.path.dirname(GLB_PATH), exist_ok=True)
    kwargs = dict(filepath=GLB_PATH, export_format="GLB", use_selection=True, export_apply=True,
                  export_yup=True, export_texcoords=True, export_normals=True,
                  export_materials="EXPORT", export_image_format="AUTO", export_extras=True)
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    kwargs = {k: v for k, v in kwargs.items() if k in props}
    if "export_draco_mesh_compression_enable" in props:
        kwargs["export_draco_mesh_compression_enable"] = False
    bpy.ops.export_scene.gltf(**kwargs)
    print("[brace] exported", GLB_PATH, os.path.getsize(GLB_PATH), "bytes")


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"

    brace_coll = bpy.data.collections.new("TaylorsBrace")
    body_coll = bpy.data.collections.new("ValidationBody")
    occ_coll = bpy.data.collections.new("Occluder")
    for c in (brace_coll, body_coll, occ_coll):
        scene.collection.children.link(c)

    tex = make_textures()
    mats = {
        "panel": make_material("Brace_PanelFabric", image=tex["panel"], rough=0.92),
        "stay": make_material("Brace_Stay", color=PAL["stay"], rough=0.85),
        "strap": make_material("Brace_PaddedStrap", image=tex["strap"], rough=0.9),
        "elastic": make_material("Brace_ElasticBelt", image=tex["elastic"], rough=0.8, sheen=0.35),
        "webbing": make_material("Brace_Webbing", image=tex["webbing"], rough=0.75, sheen=0.4),
        "velcro": make_material("Brace_Velcro", image=tex["velcro"], rough=0.97),
        "teal": make_material("Brace_Piping", color=PAL["teal"], rough=0.6),
        "buckle": make_material("Brace_BucklePlastic", color=PAL["buckle"], rough=0.45),
        "buckle_black": make_material("Brace_BuckleBlack", color=PAL["buckle_black"], rough=0.4),
    }
    skin = make_material("Validation_Skin", color=PAL["skin"], rough=0.6, sheen=0.0)
    occ_mat = make_material("Occluder", color=np.array([1.0, 0.0, 1.0]), rough=1.0, sheen=0.0)

    parts = build_brace(brace_coll, mats)
    root = bpy.data.objects.new("TaylorsBrace", None)
    brace_coll.objects.link(root)
    for ob in list(brace_coll.objects):
        if ob is not root:
            ob.parent = root
    root["refShoulderWidth"] = REF["shoulder_width"]
    root["refTorsoLength"] = REF["torso_length"]
    root["refHipWidth"] = REF["hip_width"]
    root["origin"] = "shoulder-joint midpoint; +X wearer left; faces +Z in glTF"

    occluder = build_loft("BodyOccluder", occ_coll, occ_mat, 0.06, -0.66, shrink=0.002, nz=24, nth=32)
    occluder.parent = root
    occluder["role"] = "depth-occluder"

    build_mannequin(body_coll, skin)
    cams = setup_validation(scene)

    tris = sum(len(o.data.polygons) for o in brace_coll.objects if o.type == "MESH")
    print(f"[brace] {len(parts)} components, {tris} faces")

    export_glb(brace_coll, occluder)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH, compress=True)
    print("[brace] saved", BLEND_PATH)

    if DO_RENDER:
        occ_coll.hide_render = True
        render_views(scene, cams)
        occ_coll.hide_render = False
        bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH, compress=True)


main()
