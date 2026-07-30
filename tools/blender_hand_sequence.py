"""
blender_hand_sequence.py
========================
Importa uma malha de assets-3d/, normaliza-a, e renderiza 150 frames com
LIQUIDO BRANCO A CORRER POR CIMA e a pingar — a arquitetura de duas
camadas que a referencia usa:

  · camada base  : a malha original, 1.19M tris, estatica, marmore branco.
                   Detalhe intacto, custo de simulacao ZERO.
  · camada liquida: um pano de baixa densidade, cloth sim, que cai sobre
                   a forma, agarra-se e escorre em fios pelos dedos.
  · proxy colisao : versao decimada (~6k) da malha base, invisivel no
                   render. Colidir cloth contra 1.19M tris seria
                   inutilizavel; contra 6k e instantaneo.

USO
---
    blender -b -P tools/blender_hand_sequence.py -- \
        --mesh assets-3d/hand.OBJ --frames 150 --res 1600 --samples 96 \
        --out ./raw-seq

    # teste rapido (5 frames, baixa res) - USA SEMPRE ISTO PRIMEIRO
    blender -b -P tools/blender_hand_sequence.py -- \
        --mesh assets-3d/hand.OBJ --frames 150 --res 540 --samples 24 \
        --step 30 --out ./raw-seq-test

    # so a malha, sem liquido (para validar pose/luz/enquadramento)
    blender -b -P tools/blender_hand_sequence.py -- \
        --mesh assets-3d/hand.OBJ --no-liquid --res 540 --samples 24 \
        --step 30 --out ./raw-seq-test

Saida: PNG RGBA quadrado. Depois: npm run seq:encode
Testado em Blender 5.1.
"""

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

ap = argparse.ArgumentParser()
ap.add_argument("--mesh", default="assets-3d/hand.OBJ")
ap.add_argument("--frames", type=int, default=150)
ap.add_argument("--res", type=int, default=1600)
ap.add_argument("--samples", type=int, default=96)
ap.add_argument("--step", type=int, default=1)
ap.add_argument("--out", default="./raw-seq")
ap.add_argument("--height", type=float, default=2.0, help="altura normalizada")
ap.add_argument("--flip", action="store_true",
                help="inverter o eixo dos dedos se a heuristica falhar")
ap.add_argument("--spin", type=float, default=40.0,
                help="graus em Z: separa os dedos em vez de os sobrepor")
ap.add_argument("--tilt", type=float, default=0.0,
                help="graus em Y: quebra o perfil plano")
ap.add_argument("--exposure", type=float, default=-0.9,
                help="stops. O marmore branco estoura facilmente")
ap.add_argument("--no-liquid", action="store_true")
ap.add_argument("--no-render", action="store_true")
ap.add_argument("--cpu", action="store_true")
args = ap.parse_args(argv)

FRAMES = args.frames


# ----------------------------------------------------------------------
# Base
# ----------------------------------------------------------------------
def wipe():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def force_linear_default():
    """Todas as keyframes novas nascem LINEAR.

    O timing vem do scroll (GSAP scrub). Bezier aqui = dois easings
    sobrepostos = scrubbing elastico.
    """
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"


def iter_fcurves(action):
    """Compativel com Actions legacy E com as slotted actions do 4.4+."""
    legacy = getattr(action, "fcurves", None)
    if legacy is not None:
        yield from legacy
        return
    for layer in getattr(action, "layers", []):
        for strip in layer.strips:
            for bag in getattr(strip, "channelbags", []):
                yield from bag.fcurves


def linearize(datablock):
    ad = getattr(datablock, "animation_data", None)
    if not ad or not ad.action:
        return
    for fc in iter_fcurves(ad.action):
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"


def key_value(node, fa, va, fb, vb):
    node.outputs[0].default_value = va
    node.outputs[0].keyframe_insert("default_value", frame=fa)
    node.outputs[0].default_value = vb
    node.outputs[0].keyframe_insert("default_value", frame=fb)


def only(obj):
    """Torna `obj` o unico selecionado e ativo."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


# ----------------------------------------------------------------------
# 1. Importar + normalizar
# ----------------------------------------------------------------------
def import_mesh(path):
    path = os.path.abspath(path)
    if not os.path.exists(path):
        raise SystemExit(f"[seq] malha nao encontrada: {path}")
    ext = os.path.splitext(path)[1].lower()

    before = set(bpy.context.scene.objects)
    if ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    elif ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        raise SystemExit(f"[seq] extensao nao suportada: {ext}")

    new = [o for o in bpy.context.scene.objects
           if o not in before and o.type == "MESH"]
    if not new:
        raise SystemExit("[seq] o import nao produziu malhas")

    if len(new) > 1:
        only(new[0])
        for o in new[1:]:
            o.select_set(True)
        bpy.ops.object.join()
        obj = bpy.context.active_object
    else:
        obj = new[0]

    obj.name = "Base"
    return obj


def normalize(obj):
    """Centra na origem, roda para os dedos apontarem para -Z, escala.

    A malha do CGTrader vem com bounds longe da origem e o eixo longo em
    Y. Nada disto e culpa do utilizador — resolve-se aqui.
    """
    only(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    obj.location = (0, 0, 0)
    bpy.ops.object.transform_apply(location=True)

    d = obj.dimensions
    long_axis = max(range(3), key=lambda i: d[i])
    print(f"[seq] eixo longo = {'XYZ'[long_axis]}  dims = "
          f"{d.x:.2f} {d.y:.2f} {d.z:.2f}")

    # Heuristica do lado dos dedos: a palma e o pulso sao a parte
    # volumosa, logo o centroide dos vertices fica desse lado. Os dedos
    # apontam para longe do centroide.
    verts = obj.data.vertices
    n = len(verts)
    step = max(1, n // 20000)  # amostra: 1.19M vertices nao e preciso
    total = 0.0
    count = 0
    for i in range(0, n, step):
        total += verts[i].co[long_axis]
        count += 1
    centroid = total / count
    fingers_positive = centroid < 0  # centroide no lado do pulso
    if args.flip:
        fingers_positive = not fingers_positive
    print(f"[seq] centroide no eixo longo = {centroid:+.3f}  ->  dedos em "
          f"{'+' if fingers_positive else '-'}{'XYZ'[long_axis]}")

    # Rodar de modo a que o lado dos dedos aponte para -Z (para baixo).
    # As gotas caem para baixo: os dedos passam a conduzir os fios.
    if long_axis == 1:  # Y
        obj.rotation_euler = (math.radians(90 if fingers_positive else -90), 0, 0)
    elif long_axis == 0:  # X
        obj.rotation_euler = (0, math.radians(-90 if fingers_positive else 90), 0)
    else:  # Z
        obj.rotation_euler = (math.radians(180) if fingers_positive else 0, 0, 0)
    # Rotacao em Z: e o que separa os dedos em vez de os deixar
    # sobrepostos. Um perfil puro le-se como luva, nao como mao.
    obj.rotation_euler.rotate_axis("Z", math.radians(args.spin))
    if args.tilt:
        obj.rotation_euler.rotate_axis("Y", math.radians(args.tilt))
    only(obj)
    bpy.ops.object.transform_apply(rotation=True)

    s = args.height / max(obj.dimensions)
    obj.scale = (s, s, s)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    obj.location = (0, 0, 0)
    bpy.ops.object.transform_apply(location=True)

    bpy.ops.object.shade_smooth()
    print(f"[seq] normalizada -> dims {obj.dimensions.x:.2f} "
          f"{obj.dimensions.y:.2f} {obj.dimensions.z:.2f}")
    return obj


# ----------------------------------------------------------------------
# 2. Proxy de colisao
# ----------------------------------------------------------------------
def build_collider(base, target_tris=6000):
    """Copia decimada da base, invisivel no render, so para colidir.

    Isto e o que torna o cloth viavel: colidir contra 1.19M tris levaria
    minutos por frame; contra 6k e instantaneo, e a diferenca nao se ve
    porque o liquido tem espessura propria.
    """
    col = base.copy()
    col.data = base.data.copy()
    col.name = "Collider"
    bpy.context.collection.objects.link(col)
    only(col)

    tris = sum(len(p.vertices) - 2 for p in col.data.polygons)
    dec = col.modifiers.new("Dec", "DECIMATE")
    dec.ratio = min(1.0, target_tris / max(1, tris))
    bpy.ops.object.modifier_apply(modifier=dec.name)
    print(f"[seq] collider: {tris} -> "
          f"{sum(len(p.vertices) - 2 for p in col.data.polygons)} tris")

    col.hide_render = True
    return col


# ----------------------------------------------------------------------
# 3. Camada liquida (cloth)
# ----------------------------------------------------------------------
def build_liquid(base, cache_dir):
    """Liquido FLIP (Mantaflow) a correr sobre a forma e a pingar.

    PORQUE NAO CLOTH. A primeira versao deste script usava um pano com
    tension_stiffness baixo, na expectativa de que esticasse em fios.
    Nao estica: pano com pouca tensao abre em PAINEIS planos, com
    vincos rectos e bainha visivel — le-se como lencol. O que faz uma
    gota ter ponta arredondada e TENSAO SUPERFICIAL, e cloth nao tem.
    O FLIP tem, e e o parametro `surface_tension` abaixo.

    Custo: o bake e minutos em vez de segundos, e escreve cache no
    disco. E o preco de ter gotas a serio.
    """
    d = base.dimensions

    # --- Dominio: envolve a mao e o espaco ABAIXO das pontas, que e
    #     para onde as gotas caem. Sem essa folga, os fios sao cortados.
    pad_xy = max(d.x, d.y) * 0.55
    fall = d.z * 0.75
    size_x = d.x + pad_xy * 2
    size_y = d.y + pad_xy * 2
    size_z = d.z + fall + d.z * 0.30

    bpy.ops.mesh.primitive_cube_add(size=1)
    dom = bpy.context.active_object
    dom.name = "Liquid"
    dom.scale = (size_x * 0.5, size_y * 0.5, size_z * 0.5)
    dom.location = (0, 0, d.z * 0.15 - fall * 0.5)
    only(dom)
    bpy.ops.object.transform_apply(scale=True)

    bpy.ops.object.modifier_add(type="FLUID")
    dom.modifiers["Fluid"].fluid_type = "DOMAIN"
    ds = dom.modifiers["Fluid"].domain_settings
    ds.domain_type = "LIQUID"
    ds.resolution_max = 110
    ds.use_mesh = True          # renderiza malha, nao particulas
    ds.mesh_scale = 2
    ds.mesh_particle_radius = 1.6
    ds.use_flip_particles = True

    # Os dois parametros que definem o LOOK:
    ds.use_surface_tension = True
    ds.surface_tension = 0.30   # <- pontas arredondadas, fios que nao partem
    ds.use_viscosity = True
    ds.viscosity_value = 0.08   # <- agarra-se a superficie em vez de escorrer

    ds.simulation_method = "FLIP"
    ds.flip_ratio = 0.94
    ds.timesteps_max = 6
    ds.use_adaptive_timesteps = True
    ds.cache_directory = cache_dir
    ds.cache_frame_start = 1
    ds.cache_frame_end = FRAMES
    ds.cache_type = "MODULAR"

    # --- Inflow: emite por cima da mao durante o primeiro terco, depois
    #     fecha. O resto da sequencia e o liquido a escorrer e a pingar.
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=max(d.x, d.y) * 0.30,
        location=(0, 0, d.z * 0.5 + d.z * 0.18),
    )
    inflow = bpy.context.active_object
    inflow.name = "Inflow"
    bpy.ops.object.modifier_add(type="FLUID")
    inflow.modifiers["Fluid"].fluid_type = "FLOW"
    fs = inflow.modifiers["Fluid"].flow_settings
    fs.flow_type = "LIQUID"
    fs.flow_behavior = "INFLOW"
    fs.use_inflow = True
    fs.use_inflow_keyframe = True  # marcador; as keys vao abaixo
    inflow.hide_render = True

    fs.use_inflow = True
    fs.keyframe_insert("use_inflow", frame=1)
    fs.use_inflow = True
    fs.keyframe_insert("use_inflow", frame=int(FRAMES * 0.34))
    fs.use_inflow = False
    fs.keyframe_insert("use_inflow", frame=int(FRAMES * 0.34) + 1)

    return dom, inflow


def make_effector(obj):
    """A mao passa a obstaculo do fluido."""
    only(obj)
    bpy.ops.object.modifier_add(type="FLUID")
    obj.modifiers["Fluid"].fluid_type = "EFFECTOR"
    es = obj.modifiers["Fluid"].effector_settings
    es.effector_type = "COLLISION"
    es.surface_distance = 0.012
    es.use_effector = True


def bake_liquid(dom):
    only(dom)
    print("[seq] bake do fluido (isto demora)...")
    bpy.ops.fluid.bake_all()
    print("[seq] bake concluido")


# ----------------------------------------------------------------------
# 4. Material
# ----------------------------------------------------------------------
def build_material(objs):
    """Marmore/gesso branco. Substitui qualquer material importado.

    E este override que faz a malha ler como ESCULTURA em vez de asset
    de jogo — e a razao pela qual as texturas do download nao importam.
    """
    mat = bpy.data.materials.new("Marble")
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.94, 0.935, 0.92, 1.0)
    b.inputs["Roughness"].default_value = 0.30
    b.inputs["Metallic"].default_value = 0.0

    # Subsurface: sem isto o branco fica morto, como plastico.
    for name, val in (("Subsurface Weight", 0.16), ("Subsurface Scale", 0.04)):
        if name in b.inputs:
            b.inputs[name].default_value = val
    for name, val in (("Coat Weight", 0.28), ("Coat Roughness", 0.16)):
        if name in b.inputs:
            b.inputs[name].default_value = val

    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(mat)
    return mat


# ----------------------------------------------------------------------
# 5. Estudio
# ----------------------------------------------------------------------
def build_world():
    w = bpy.data.worlds.new("Studio")
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    grad = nt.nodes.new("ShaderNodeTexGradient")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    mapping = nt.nodes.new("ShaderNodeMapping")
    co = nt.nodes.new("ShaderNodeTexCoord")

    mapping.inputs["Rotation"].default_value = (math.radians(90), 0, 0)
    # Mundo escuro em baixo: e o que faz as reentrancias entre os dedos
    # ficarem realmente escuras. Um mundo claro achata tudo.
    e = ramp.color_ramp.elements
    e[0].position = 0.30
    e[0].color = (0.02, 0.022, 0.028, 1)
    e[1].position = 0.95
    e[1].color = (0.62, 0.615, 0.60, 1)
    bg.inputs["Strength"].default_value = 0.35

    nt.links.new(co.outputs["Generated"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], grad.inputs["Vector"])
    nt.links.new(grad.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])


def softbox(name, loc, rot, size, power):
    bpy.ops.object.light_add(type="AREA", location=loc, rotation=rot)
    L = bpy.context.active_object
    L.name = name
    L.data.shape = "RECTANGLE"
    L.data.size = size[0]
    L.data.size_y = size[1]
    L.data.energy = power
    return L


def build_lights():
    # Key mais pequena e mais rasante que o instinto manda: uma softbox
    # enorme e frontal apaga a forma. O que dá volume ao branco é a
    # sombra, não a luz.
    softbox("Key", (2.6, -2.4, 3.2),
            (math.radians(58), 0, math.radians(46)), (3.2, 2.2), 260)
    # Rim atras: separa a silhueta do fundo transparente.
    softbox("Rim", (-2.8, 3.0, 1.2),
            (math.radians(-66), 0, math.radians(36)), (3.5, 3.5), 190)
    # Fill muito fraco: só levanta o preto, não ilumina.
    softbox("Fill", (-2.2, -2.6, 0.0),
            (math.radians(86), 0, math.radians(-42)), (3, 3), 45)


# ----------------------------------------------------------------------
# 6. Camara
# ----------------------------------------------------------------------
def tip_centroid(obj, frac=0.03):
    """Centroide da ponta inferior da malha (as pontas dos dedos).

    Derivado da geometria, não escrito à mão: um asset diferente tem as
    pontas noutro sítio, e o enquadramento final tem de as seguir.
    """
    co = [v.co for v in obj.data.vertices]
    zs = sorted(c.z for c in co)
    cutoff = zs[max(0, int(len(zs) * frac))]
    sel = [c for c in co if c.z <= cutoff]
    n = len(sel) or 1
    return Vector((
        sum(c.x for c in sel) / n,
        sum(c.y for c in sel) / n,
        sum(c.z for c in sel) / n,
    ))


def build_camera(base):
    LENS = 66.0
    SENSOR = 36.0
    # Render quadrado -> o FOV vertical vem de metade do sensor.
    half_fov = math.atan((SENSOR * 0.5) / LENS)
    dist_for = lambda vis_h: (vis_h * 0.5) / math.tan(half_fov)

    H = base.dimensions.z
    top = H * 0.5
    tip = tip_centroid(base)

    # PROFUNDIDADE. `dist_for` dá o enquadramento no plano do alvo, mas
    # a mão tem 1.37 de espessura em Y: as partes viradas para a câmara
    # estão MAIS PERTO que esse plano, aparecem ampliadas e saem do
    # frame. Somar meia profundidade é o que corrige — foi exatamente
    # este erro que cortou os dedos nos dois testes anteriores.
    half_depth = base.dimensions.y * 0.5

    # Frame 1: mão inteira com ar, pulso a sair pelo topo. O pulso é um
    # corte plano do sculpt: visto inteiro lê-se como prop cortado, e
    # enquadrá-lo fora é mais barato que tapá-lo com geometria.
    start_vis = H * 1.16
    end_vis = H * 0.62

    start_tgt = Vector((0.0, 0.0, top - start_vis * 0.42))
    end_tgt = Vector((tip.x * 0.6, 0.0, tip.z + end_vis * 0.40))
    print(f"[seq] pontas em ({tip.x:+.2f}, {tip.y:+.2f}, {tip.z:+.2f})  "
          f"meia-profundidade {half_depth:.2f}")

    bpy.ops.object.camera_add()
    cam = bpy.context.active_object
    cam.name = "SeqCam"
    cam.data.lens = LENS
    cam.data.sensor_width = SENSOR
    bpy.context.scene.camera = cam

    tgt = bpy.data.objects.new("CamTarget", None)
    bpy.context.collection.objects.link(tgt)
    con = cam.constraints.new("TRACK_TO")
    con.target = tgt
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"

    # Distâncias derivadas do FOV, não escritas à mão: mudar a lente ou
    # a altura do asset reajusta-se sozinho.
    d0 = dist_for(start_vis) + half_depth
    d1 = dist_for(end_vis) + half_depth * 0.6

    cam.location = (0.0, -d0, start_tgt.z)
    cam.keyframe_insert("location", frame=1)
    # Deriva lateral pequena: dá paralaxe entre dedos durante o push-in.
    cam.location = (d1 * 0.22, -d1 * 0.97, end_tgt.z)
    cam.keyframe_insert("location", frame=FRAMES)

    tgt.location = start_tgt
    tgt.keyframe_insert("location", frame=1)
    tgt.location = end_tgt
    tgt.keyframe_insert("location", frame=FRAMES)

    linearize(cam)
    linearize(tgt)
    return cam


# ----------------------------------------------------------------------
# 7. Render
# ----------------------------------------------------------------------
def setup_render():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = args.samples
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
    sc.cycles.max_bounces = 10
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.01

    if not args.cpu:
        sc.cycles.device = "GPU"
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for backend in ("OPTIX", "HIP", "METAL", "ONEAPI", "CUDA"):
            try:
                prefs.compute_device_type = backend
                prefs.get_devices()
                if any(d.type == backend for d in prefs.devices):
                    for d in prefs.devices:
                        d.use = d.type != "CPU"
                    print(f"[seq] GPU: {backend}")
                    break
            except Exception:
                continue

    # QUADRADO: 1:1 sobrevive a qualquer aspect ratio no browser com
    # object-fit cover, portrait incluido.
    sc.render.resolution_x = sc.render.resolution_y = args.res
    sc.render.resolution_percentage = 100
    sc.render.fps = 30

    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "8"
    sc.render.image_settings.compression = 15
    try:
        sc.view_settings.view_transform = "Standard"
        sc.view_settings.exposure = args.exposure
    except Exception:
        pass

    sc.frame_start = 1
    sc.frame_end = FRAMES
    sc.frame_step = args.step

    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    sc.render.filepath = os.path.join(out, "frame_")
    return out


# ----------------------------------------------------------------------
def main():
    wipe()
    force_linear_default()

    base = normalize(import_mesh(args.mesh))
    render_objs = [base]
    dom = None

    if not args.no_liquid:
        # O fluido colide contra um proxy decimado: contra 1.19M tris
        # o bake seria inutilizavel, e a diferenca nao se ve porque o
        # liquido tem espessura propria.
        collider = build_collider(base)
        make_effector(collider)
        cache = os.path.join(os.path.abspath(args.out), "_fluidcache")
        dom, _ = build_liquid(base, cache)
        render_objs.append(dom)

    build_material(render_objs)
    build_world()
    build_lights()
    build_camera(base)
    out = setup_render()

    if dom is not None:
        bake_liquid(dom)

    print(f"[seq] {FRAMES} frames @ {args.res}x{args.res} (step {args.step})"
          f" -> {out}")
    if args.no_render:
        print("[seq] cena construida (--no-render)")
        return
    bpy.ops.render.render(animation=True)
    print("[seq] feito. proximo: npm run seq:encode")


main()
