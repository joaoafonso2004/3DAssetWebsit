"""
blender_liquid_sequence.py
==========================
Constroi e renderiza, do zero e sem assets externos, uma sequencia de
frames para scroll-scrubbing: um MONOLITO DE CROMO LIQUIDO que se
agita e escorre enquanto a camara faz push-in.

Substitui a cabeca do video de referencia mantendo exatamente a mesma
linguagem visual: forma clara e brilhante sobre fundo TRANSPARENTE,
camara a aproximar, movimento continuo do primeiro ao ultimo frame.

USO
---
    blender -b -P tools/blender_liquid_sequence.py -- \
        --frames 150 --res 1600 --samples 96 --out ./raw-seq

    # teste rapido: 1 em cada 10 frames, 24 samples
    blender -b -P tools/blender_liquid_sequence.py -- \
        --frames 150 --res 800 --samples 24 --step 10 --out ./raw-seq-test

    # abrir a cena na GUI em vez de renderizar
    blender -P tools/blender_liquid_sequence.py -- --no-render

Saida: raw-seq/frame_0001.png ... frame_0150.png  (PNG RGBA)
Depois:  npm run seq:encode

Testado em Blender 4.2 LTS / 4.5. Requer Cycles (vem de base).
"""

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

# ----------------------------------------------------------------------
# Argumentos (tudo depois de "--")
# ----------------------------------------------------------------------
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

ap = argparse.ArgumentParser()
ap.add_argument("--frames", type=int, default=150, help="numero de frames")
ap.add_argument("--res", type=int, default=1600, help="lado do quadrado")
ap.add_argument("--samples", type=int, default=96)
ap.add_argument("--step", type=int, default=1, help="frame_step (preview)")
ap.add_argument("--out", default="./raw-seq")
ap.add_argument("--no-render", action="store_true")
ap.add_argument("--cpu", action="store_true")
args = ap.parse_args(argv)

FRAMES = args.frames


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------
def wipe():
    """Cena vazia, sem depender do ficheiro de arranque do utilizador."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def force_linear_default():
    """Todas as keyframes novas nascem LINEAR.

    CRITICO: o timing da animacao e dado pelo scroll (GSAP scrub). Se as
    keyframes tiverem Bezier, ficas com dois easings sobrepostos e o
    scrubbing parece elastico. Tudo LINEAR, sempre.

    Feito na preferencia em vez de a corrigir depois porque funciona em
    qualquer versao do Blender e nao depende da API de Actions.
    """
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"


def iter_fcurves(action):
    """F-Curves de uma Action, em Blender legacy E 4.4+/5.x.

    A partir do 4.4 as Actions passaram a ter camadas ("slotted actions")
    e `Action.fcurves` deixou de existir: as curvas vivem em
    action.layers[].strips[].channelbags[].fcurves
    """
    legacy = getattr(action, "fcurves", None)
    if legacy is not None:
        yield from legacy
        return
    for layer in getattr(action, "layers", []):
        for strip in layer.strips:
            for bag in getattr(strip, "channelbags", []):
                yield from bag.fcurves


def linearize(datablock):
    """Rede de seguranca: garante LINEAR mesmo em curvas ja existentes."""
    ad = getattr(datablock, "animation_data", None)
    if not ad or not ad.action:
        return
    for fc in iter_fcurves(ad.action):
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"


def key_value(node, frame_a, val_a, frame_b, val_b):
    """Keyframes lineares num ShaderNodeValue."""
    node.outputs[0].default_value = val_a
    node.outputs[0].keyframe_insert("default_value", frame=frame_a)
    node.outputs[0].default_value = val_b
    node.outputs[0].keyframe_insert("default_value", frame=frame_b)


# ----------------------------------------------------------------------
# 1. Malha base
# ----------------------------------------------------------------------
def build_base():
    """Icosfera alongada: da uma silhueta vertical de 'monolito'.

    Troca por outra coisa aqui e o resto do script continua a funcionar:
      · bpy.ops.mesh.primitive_torus_add(major_radius=1, minor_radius=.35)
      · bpy.ops.mesh.primitive_monkey_add()   (Suzanne, para testar)
      · bpy.ops.import_scene.gltf(filepath=...)  o teu proprio asset
    """
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=1.0)
    obj = bpy.context.active_object
    obj.name = "MoltenForm"
    obj.scale = (0.92, 0.92, 1.35)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.shade_smooth()
    return obj


# ----------------------------------------------------------------------
# 2. Geometry Nodes: agitacao 4D + escorrer
# ----------------------------------------------------------------------
def build_geometry_nodes(obj):
    ng = bpy.data.node_groups.new("MoltenGN", "GeometryNodeTree")

    # API de interface mudou na 4.0
    if hasattr(ng, "interface"):
        ng.interface.new_socket("Geometry", in_out="INPUT",
                                socket_type="NodeSocketGeometry")
        ng.interface.new_socket("Geometry", in_out="OUTPUT",
                                socket_type="NodeSocketGeometry")
    else:  # 3.x
        ng.inputs.new("NodeSocketGeometry", "Geometry")
        ng.outputs.new("NodeSocketGeometry", "Geometry")

    n = ng.nodes
    link = ng.links.new

    g_in = n.new("NodeGroupInput")
    g_in.location = (-1400, 0)
    g_out = n.new("NodeGroupOutput")
    g_out.location = (700, 0)

    # Densidade suficiente para o escorrer nao facetar.
    subdiv = n.new("GeometryNodeSubdivisionSurface")
    subdiv.location = (-1180, 0)
    subdiv.inputs["Level"].default_value = 2

    pos = n.new("GeometryNodeInputPosition")
    pos.location = (-1180, -320)

    # --- A. Agitacao organica: ruido 4D, W animado ------------------
    # 4D e o truque: em vez de mover o objeto pelo ruido, movemos o
    # ruido "pelo tempo". Da liquido, nao da objeto a deslizar.
    v_morph = n.new("ShaderNodeValue")
    v_morph.label = "Morph (W do ruido)"
    v_morph.location = (-1180, -560)

    noise = n.new("ShaderNodeTexNoise")
    noise.location = (-960, -360)
    noise.noise_dimensions = "4D"
    noise.inputs["Scale"].default_value = 1.45
    noise.inputs["Detail"].default_value = 6.0
    noise.inputs["Roughness"].default_value = 0.55

    center = n.new("ShaderNodeVectorMath")   # ruido 0..1 -> -0.5..0.5
    center.location = (-740, -360)
    center.operation = "SUBTRACT"
    center.inputs[1].default_value = (0.5, 0.5, 0.5)

    v_amp = n.new("ShaderNodeValue")
    v_amp.label = "Amplitude da agitacao"
    v_amp.location = (-960, -600)

    churn = n.new("ShaderNodeVectorMath")
    churn.location = (-540, -360)
    churn.operation = "SCALE"

    # --- B. Escorrer: alongamento para baixo, so na metade inferior --
    sep = n.new("ShaderNodeSeparateXYZ")
    sep.location = (-960, -820)

    gate = n.new("ShaderNodeMapRange")       # Z alto = 0, Z baixo = 1
    gate.location = (-740, -820)
    gate.inputs["From Min"].default_value = 0.55
    gate.inputs["From Max"].default_value = -1.30
    gate.inputs["To Min"].default_value = 0.0
    gate.inputs["To Max"].default_value = 1.0
    gate.clamp = True

    strands = n.new("ShaderNodeTexNoise")    # variacao por "coluna"
    strands.location = (-960, -1080)
    strands.noise_dimensions = "3D"
    strands.inputs["Scale"].default_value = 5.5
    strands.inputs["Detail"].default_value = 2.0

    sharpen = n.new("ShaderNodeMath")        # contrasta os fios
    sharpen.location = (-740, -1080)
    sharpen.operation = "POWER"
    sharpen.inputs[1].default_value = 2.6

    v_drip = n.new("ShaderNodeValue")
    v_drip.label = "Comprimento do escorrer"
    v_drip.location = (-740, -1300)

    m1 = n.new("ShaderNodeMath")
    m1.location = (-520, -900)
    m1.operation = "MULTIPLY"

    m2 = n.new("ShaderNodeMath")
    m2.location = (-340, -900)
    m2.operation = "MULTIPLY"

    down = n.new("ShaderNodeCombineXYZ")
    down.location = (-160, -900)

    neg = n.new("ShaderNodeMath")
    neg.location = (-160, -1100)
    neg.operation = "MULTIPLY"
    neg.inputs[1].default_value = -1.0

    total = n.new("ShaderNodeVectorMath")
    total.location = (60, -500)
    total.operation = "ADD"

    setpos = n.new("GeometryNodeSetPosition")
    setpos.location = (300, 0)

    smooth = n.new("GeometryNodeSetShadeSmooth")
    smooth.location = (500, 0)

    # --- ligacoes ----------------------------------------------------
    link(g_in.outputs[0], subdiv.inputs["Mesh"])
    link(subdiv.outputs["Mesh"], setpos.inputs["Geometry"])

    link(pos.outputs["Position"], noise.inputs["Vector"])
    link(v_morph.outputs[0], noise.inputs["W"])
    link(noise.outputs["Color"], center.inputs[0])
    link(center.outputs["Vector"], churn.inputs[0])
    link(v_amp.outputs[0], churn.inputs["Scale"])

    link(pos.outputs["Position"], sep.inputs["Vector"])
    link(sep.outputs["Z"], gate.inputs["Value"])
    link(pos.outputs["Position"], strands.inputs["Vector"])
    link(strands.outputs["Fac"], sharpen.inputs[0])

    link(gate.outputs["Result"], m1.inputs[0])
    link(sharpen.outputs[0], m1.inputs[1])
    link(m1.outputs[0], m2.inputs[0])
    link(v_drip.outputs[0], m2.inputs[1])
    link(m2.outputs[0], neg.inputs[0])
    link(neg.outputs[0], down.inputs["Z"])

    link(churn.outputs["Vector"], total.inputs[0])
    link(down.outputs["Vector"], total.inputs[1])
    link(total.outputs["Vector"], setpos.inputs["Offset"])

    link(setpos.outputs["Geometry"], smooth.inputs["Geometry"])
    link(smooth.outputs["Geometry"], g_out.inputs[0])

    # --- animacao ----------------------------------------------------
    # Morph avanca sempre (o liquido nunca para de se mexer).
    key_value(v_morph, 1, 0.0, FRAMES, 3.4)
    # Amplitude cresce um pouco: a forma "solta-se" ao longo do scroll.
    key_value(v_amp, 1, 0.16, FRAMES, 0.30)
    # O escorrer e o arco narrativo: 0 no inicio, longo no fim.
    key_value(v_drip, 1, 0.0, FRAMES, 1.15)
    linearize(ng)

    mod = obj.modifiers.new("Molten", "NODES")
    mod.node_group = ng
    return ng


# ----------------------------------------------------------------------
# 3. Material: cromo com pelicula fina iridescente
# ----------------------------------------------------------------------
def build_material(obj):
    mat = bpy.data.materials.new("LiquidChrome")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]

    bsdf.inputs["Base Color"].default_value = (0.86, 0.87, 0.89, 1.0)
    bsdf.inputs["Metallic"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.085
    if "IOR" in bsdf.inputs:
        bsdf.inputs["IOR"].default_value = 1.5

    # Coat: aquele verniz que faz os highlights alongarem.
    for name, val in (("Coat Weight", 0.6), ("Coat Roughness", 0.05)):
        if name in bsdf.inputs:
            bsdf.inputs[name].default_value = val

    # Iridescencia real (Blender 4.2+): pelicula fina.
    # E o que da o brilho "oleo/perola" sem parecer um filtro.
    for name, val in (("Thin Film Thickness", 420.0),
                      ("Thin Film IOR", 1.42)):
        if name in bsdf.inputs:
            bsdf.inputs[name].default_value = val

    obj.data.materials.append(mat)
    return mat


# ----------------------------------------------------------------------
# 4. Estudio: cromo precisa de ambiente, nao de lampadas pontuais
# ----------------------------------------------------------------------
def build_world():
    world = bpy.data.worlds.new("Studio")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    grad = nt.nodes.new("ShaderNodeTexGradient")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    mapping = nt.nodes.new("ShaderNodeMapping")
    tex_co = nt.nodes.new("ShaderNodeTexCoord")

    mapping.inputs["Rotation"].default_value = (math.radians(90), 0, 0)
    ramp.color_ramp.elements[0].position = 0.32
    ramp.color_ramp.elements[0].color = (0.03, 0.035, 0.045, 1)
    ramp.color_ramp.elements[1].position = 0.88
    ramp.color_ramp.elements[1].color = (1.0, 0.99, 0.97, 1)
    bg.inputs["Strength"].default_value = 1.15

    nt.links.new(tex_co.outputs["Generated"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], grad.inputs["Vector"])
    nt.links.new(grad.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])


def add_softbox(name, loc, rot, size, power):
    bpy.ops.object.light_add(type="AREA", location=loc, rotation=rot)
    light = bpy.context.active_object
    light.name = name
    light.data.shape = "RECTANGLE"
    light.data.size = size[0]
    light.data.size_y = size[1]
    light.data.energy = power
    return light


def build_lights():
    # Key alta e grande: highlight comprido em cima da forma.
    add_softbox("Key", (3.0, -3.4, 4.2),
                (math.radians(52), 0, math.radians(42)), (7, 4), 900)
    # Rim atras: separa a silhueta do fundo transparente.
    add_softbox("Rim", (-3.2, 3.6, 1.6),
                (math.radians(-64), 0, math.radians(38)), (5, 5), 600)
    # Fill frontal fraco: mantem detalhe nas sombras do cromo.
    add_softbox("Fill", (-2.6, -3.0, 0.4),
                (math.radians(84), 0, math.radians(-40)), (4, 4), 180)


# ----------------------------------------------------------------------
# 5. Camara: push-in linear com um leve arco
# ----------------------------------------------------------------------
def build_camera():
    bpy.ops.object.camera_add(location=(0, -7.2, 0.35))
    cam = bpy.context.active_object
    cam.name = "SeqCam"
    cam.data.lens = 62          # ligeiro tele: menos distorcao nas bordas
    cam.data.sensor_width = 36
    bpy.context.scene.camera = cam

    # Alvo para a camara seguir (mantem o sujeito centrado no push-in).
    target = bpy.data.objects.new("CamTarget", None)
    bpy.context.collection.objects.link(target)
    target.location = (0, 0, 0.1)
    con = cam.constraints.new("TRACK_TO")
    con.target = target
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"

    # Frame 1: plano largo. Frame N: dentro do liquido.
    # O crescimento que ves no video e ISTO, nao um scale em CSS.
    keys = (
        (1,      Vector((0.00, -7.20, 0.35))),
        (FRAMES, Vector((1.05, -2.55, -0.55))),
    )
    for f, loc in keys:
        cam.location = loc
        cam.keyframe_insert("location", frame=f)

    # O alvo desce: no fim o enquadramento corta em baixo, como no video.
    target.location = (0, 0, 0.25)
    target.keyframe_insert("location", frame=1)
    target.location = (0, 0, -0.35)
    target.keyframe_insert("location", frame=FRAMES)

    linearize(cam)
    linearize(target)
    return cam


# ----------------------------------------------------------------------
# 6. Render
# ----------------------------------------------------------------------
def setup_render():
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.cycles.max_bounces = 12
    scene.cycles.glossy_bounces = 8
    scene.cycles.transmission_bounces = 8
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.01

    if not args.cpu:
        scene.cycles.device = "GPU"
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

    # QUADRADO. Um render 1:1 sobrevive a qualquer aspect ratio no
    # browser com object-fit cover, portrait incluido.
    scene.render.resolution_x = args.res
    scene.render.resolution_y = args.res
    scene.render.resolution_percentage = 100
    scene.render.fps = 30

    # O que torna isto utilizavel num site: alpha.
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 15

    # Filmic/AgX escureceria o cromo. Standard mantem o branco branco.
    try:
        scene.view_settings.view_transform = "Standard"
    except Exception:
        pass

    scene.frame_start = 1
    scene.frame_end = FRAMES
    scene.frame_step = args.step

    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    scene.render.filepath = os.path.join(out, "frame_")
    return out


# ----------------------------------------------------------------------
# main
# ----------------------------------------------------------------------
def main():
    wipe()
    force_linear_default()
    obj = build_base()
    build_geometry_nodes(obj)
    build_material(obj)
    build_world()
    build_lights()
    build_camera()
    out = setup_render()

    print(f"[seq] {FRAMES} frames @ {args.res}x{args.res} -> {out}")
    if args.no_render:
        print("[seq] cena construida (--no-render)")
        return
    bpy.ops.render.render(animation=True)
    print("[seq] feito. proximo passo: npm run seq:encode")


main()
