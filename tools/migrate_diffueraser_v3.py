#!/usr/bin/env python3
"""
Migrate ComfyUI workflow from legacy DiffuEraserLoader/DiffuEraserSampler
to V3 API: DiffuEraser_Loader, DiffuEraser_PreData, Propainter_*, CLIP*, DiffuEraser_Sampler.
"""
from __future__ import annotations

import json
import sys
from copy import deepcopy
from pathlib import Path


def tmpl_diffu_loader(pos_offset):
    x, y = pos_offset
    return {
        "type": "DiffuEraser_Loader",
        "pos": [x, y],
        "size": [400, 90],
        "flags": {},
        "mode": 0,
        "inputs": [],
        "outputs": [
            {
                "name": "model",
                "type": "DiffuEraser_Loader",
                "links": [],
            }
        ],
        "properties": {
            "cnr_id": "ComfyUI_DiffuEraser",
            "ver": "c8461876ad092206ccb1f951bb2ef5820ad7028f",
            "Node name for S&R": "DiffuEraser_Loader",
            "ue_properties": {
                "widget_ue_connectable": {},
                "version": "7.8",
                "input_ue_unconnectable": {},
            },
        },
        "widgets_values": [
            "sd-vae-ft-mse.safetensors",
            "pcm_sd15_smallcfg_2step_converted.safetensors",
        ],
    }


def tmpl_pre_data(pos):
    return {
        "type": "DiffuEraser_PreData",
        "pos": [pos[0] - 80, pos[1] + 120],
        "size": [280, 100],
        "flags": {},
        "mode": 0,
        "inputs": [
            {"name": "images", "type": "IMAGE", "link": None},
            {"name": "video_mask_image", "shape": 7, "type": "IMAGE", "link": None},
            {"name": "video_mask", "shape": 7, "type": "MASK", "link": None},
        ],
        "outputs": [
            {"name": "conditioning", "type": "CONDITIONING", "links": []},
        ],
        "properties": {
            "cnr_id": "ComfyUI_DiffuEraser",
            "ver": "c8461876ad092206ccb1f951bb2ef5820ad7028f",
            "Node name for S&R": "DiffuEraser_PreData",
            "ue_properties": {
                "widget_ue_connectable": {},
                "version": "7.8",
                "input_ue_unconnectable": {},
            },
        },
        "widgets_values": ["briaai/RMBG-2.0"],
    }


def tmpl_prop_loader(pos):
    return {
        "type": "Propainter_Loader",
        "pos": [pos[0] - 200, pos[1] - 80],
        "size": [360, 130],
        "flags": {},
        "mode": 0,
        "inputs": [],
        "outputs": [
            {"name": "model", "type": "Propainter_Loader", "links": []},
        ],
        "properties": {
            "cnr_id": "ComfyUI_DiffuEraser",
            "ver": "c8461876ad092206ccb1f951bb2ef5820ad7028f",
            "Node name for S&R": "Propainter_Loader",
            "ue_properties": {
                "widget_ue_connectable": {},
                "version": "7.8",
                "input_ue_unconnectable": {},
            },
        },
        "widgets_values": [
            "propainter\\ProPainter.pth",
            "propainter\\recurrent_flow_completion.pth",
            "propainter\\raft-things.pth",
            "cpu",
        ],
    }


def tmpl_prop_sampler(pos):
    return {
        "type": "Propainter_Sampler",
        "pos": [pos[0] + 40, pos[1] - 20],
        "size": [270, 200],
        "flags": {},
        "mode": 0,
        "inputs": [
            {"name": "model", "type": "Propainter_Loader", "link": None},
            {"name": "conditioning", "type": "CONDITIONING", "link": None},
            {
                "name": "fps",
                "type": "FLOAT",
                "link": None,
            },
        ],
        "outputs": [
            {"name": "conditioning", "type": "CONDITIONING", "links": []},
            {"name": "images", "type": "IMAGE", "links": []},
        ],
        "properties": {
            "cnr_id": "ComfyUI_DiffuEraser",
            "ver": "c8461876ad092206ccb1f951bb2ef5820ad7028f",
            "Node name for S&R": "Propainter_Sampler",
            "ue_properties": {
                "widget_ue_connectable": {},
                "version": "7.8",
                "input_ue_unconnectable": {},
            },
        },
        "widgets_values": [10, 8, 10, 10, 50],
    }


def tmpl_diff_sampler(pos):
    return {
        "type": "DiffuEraser_Sampler",
        "pos": [pos[0] + 200, pos[1] + 40],
        "size": [270, 250],
        "flags": {},
        "mode": 0,
        "inputs": [
            {"name": "model", "type": "DiffuEraser_Loader", "link": None},
            {"name": "positive", "type": "CONDITIONING", "link": None},
            {"name": "conditioning", "type": "CONDITIONING", "link": None},
        ],
        "outputs": [
            {"name": "image", "type": "IMAGE", "links": []},
        ],
        "properties": {
            "cnr_id": "ComfyUI_DiffuEraser",
            "ver": "c8461876ad092206ccb1f951bb2ef5820ad7028f",
            "Node name for S&R": "DiffuEraser_Sampler",
            "ue_properties": {
                "widget_ue_connectable": {},
                "version": "7.8",
                "input_ue_unconnectable": {},
            },
        },
        "widgets_values": [2, 1428113184, "fixed", False, 5, 5, False],
    }


def tmpl_clip_loader(pos):
    return {
        "type": "CLIPLoader",
        "pos": [pos[0] - 420, pos[1] - 200],
        "size": [270, 110],
        "flags": {},
        "mode": 0,
        "inputs": [],
        "outputs": [
            {"name": "CLIP", "type": "CLIP", "links": []},
        ],
        "properties": {
            "cnr_id": "comfy-core",
            "ver": "0.20.1",
            "Node name for S&R": "CLIPLoader",
            "ue_properties": {
                "widget_ue_connectable": {},
                "version": "7.8",
                "input_ue_unconnectable": {},
            },
        },
        "widgets_values": ["clip_l.safetensors", "stable_diffusion", "default"],
    }


def tmpl_clip_encode(pos):
    return {
        "type": "CLIPTextEncode",
        "pos": [pos[0] - 200, pos[1] - 220],
        "size": [400, 200],
        "flags": {"collapsed": True},
        "mode": 0,
        "inputs": [
            {"name": "clip", "type": "CLIP", "link": None},
        ],
        "outputs": [
            {"name": "CONDITIONING", "type": "CONDITIONING", "links": []},
        ],
        "properties": {
            "cnr_id": "comfy-core",
            "ver": "0.20.1",
            "Node name for S&R": "CLIPTextEncode",
            "ue_properties": {
                "widget_ue_connectable": {},
                "version": "7.8",
                "input_ue_unconnectable": {},
            },
        },
        "widgets_values": [""],
    }


def migrate(path_in: Path, path_out: Path) -> None:
    data = json.loads(path_in.read_text(encoding="utf-8"))
    nodes = data["nodes"]
    links = data["links"]

    max_id = max(n["id"] for n in nodes)
    next_id = max_id + 1

    # Shared CLIP subgraph (one encode output -> all DiffuEraser_Sampler positives)
    clip_loader_id = next_id
    next_id += 1
    clip_encode_id = next_id
    next_id += 1

    # Pick position near first sampler for CLIP nodes
    first_s = next(n for n in nodes if n.get("type") == "DiffuEraserSampler")
    base_pos = first_s["pos"]
    clip_loader = tmpl_clip_loader([base_pos[0], base_pos[1]])
    clip_loader["id"] = clip_loader_id
    clip_loader["order"] = 0
    clip_encode = tmpl_clip_encode([base_pos[0], base_pos[1]])
    clip_encode["id"] = clip_encode_id
    clip_encode["order"] = 0

    samplers = [n for n in nodes if n.get("type") == "DiffuEraserSampler"]
    sampler_ids = {n["id"] for n in samplers}

    # Map old_sampler_id -> (pre_id, pl_id, ps_id, ds_id, loader_src_id)
    subgraph: dict[int, tuple[int, int, int, int, int | None]] = {}

    new_nodes: list[dict] = []
    for s in samplers:
        sid = s["id"]
        pos = s["pos"]
        wv = s.get("widgets_values") or []
        if len(wv) >= 9:
            prop = wv[5:10]
        else:
            prop = [10, 8, 10, 10, 50]
        seed = wv[1] if len(wv) > 1 else 1428113184
        sched = wv[2] if len(wv) > 2 else "fixed"

        pre_id = next_id
        next_id += 1
        pl_id = next_id
        next_id += 1
        ps_id = next_id
        next_id += 1
        ds_id = next_id
        next_id += 1

        loader_src = None
        for L in links:
            _lid, fn, fs, tn, ts, _ = L
            if tn == sid and ts == 0:
                loader_src = fn
                break

        subgraph[sid] = (pre_id, pl_id, ps_id, ds_id, loader_src)

        pre = tmpl_pre_data(pos)
        pre["id"] = pre_id
        pre["order"] = s.get("order", 0)

        pl = tmpl_prop_loader(pos)
        pl["id"] = pl_id
        pl["order"] = s.get("order", 0)

        ps = tmpl_prop_sampler(pos)
        ps["id"] = ps_id
        ps["order"] = s.get("order", 0)
        ps["widgets_values"] = list(prop)

        ds = tmpl_diff_sampler(pos)
        ds["id"] = ds_id
        ds["order"] = s.get("order", 0)
        w = ds["widgets_values"]
        w[1] = seed
        w[2] = sched if sched in ("fixed", "randomize", "increment") else "fixed"

        new_nodes.extend([pre, pl, ps, ds])

    # Upgrade loaders
    for n in nodes:
        if n.get("type") != "DiffuEraserLoader":
            continue
        pcm = (
            n["widgets_values"][1]
            if len(n.get("widgets_values", [])) > 1
            else "pcm_sd15_smallcfg_2step_converted.safetensors"
        )
        n["type"] = "DiffuEraser_Loader"
        n["widgets_values"] = ["sd-vae-ft-mse.safetensors", pcm]
        n["outputs"][0]["type"] = "DiffuEraser_Loader"
        n["properties"] = {
            "cnr_id": "ComfyUI_DiffuEraser",
            "ver": "c8461876ad092206ccb1f951bb2ef5820ad7028f",
            "Node name for S&R": "DiffuEraser_Loader",
            "ue_properties": {
                "widget_ue_connectable": {},
                "version": "7.8",
                "input_ue_unconnectable": {},
            },
        }
        if "size" not in n or n["size"][0] < 350:
            n["size"] = [400, 90]

    # Remove old samplers from node list
    nodes = [n for n in nodes if n.get("type") != "DiffuEraserSampler"]
    nodes.extend(new_nodes)
    nodes.append(clip_loader)
    nodes.append(clip_encode)
    data["nodes"] = nodes
    data["last_node_id"] = max(n["id"] for n in nodes)

    # --- Links rewrite ---
    max_link = max(L[0] for L in links)
    next_link = max_link + 1

    def new_link(fn, fs, tn, ts, typ):
        nonlocal next_link
        lid = next_link
        next_link += 1
        return [lid, fn, fs, tn, ts, typ]

    new_links: list[list] = []
    # CLIP chain (shared)
    lk_clip = new_link(clip_loader_id, 0, clip_encode_id, 0, "CLIP")

    for L in links:
        lid, fn, fs, tn, ts, typ = L
        if tn in sampler_ids:
            continue  # drop inbound to old sampler; rebuilt below
        if fn in sampler_ids and fs == 0:
            # Old output was "images" -> new DiffuEraser_Sampler output name image, slot 0
            ds_id = subgraph[fn][3]
            new_links.append([lid, ds_id, 0, tn, ts, typ])
            continue
        if fn in sampler_ids:
            continue
        new_links.append(L)

    # Inbound to each old sampler -> new routing
    for L in links:
        lid, fn, fs, tn, ts, typ = L
        if tn not in sampler_ids:
            continue
        pre_id, pl_id, ps_id, ds_id, loader_src = subgraph[tn]
        if ts == 0 and loader_src is not None:
            new_links.append(
                new_link(loader_src, 0, ds_id, 0, "DiffuEraser_Loader"),
            )
        elif ts == 1:
            new_links.append(new_link(fn, fs, pre_id, 0, "IMAGE"))
        elif ts == 2:
            new_links.append(new_link(fn, fs, pre_id, 1, "IMAGE"))
        elif ts == 3:
            new_links.append(new_link(fn, fs, ps_id, 2, "FLOAT"))

    # Internal subgraph links + CLIP -> each DiffuEraser_Sampler
    for sid, (pre_id, pl_id, ps_id, ds_id, _ls) in subgraph.items():
        new_links.append(new_link(pl_id, 0, ps_id, 0, "Propainter_Loader"))
        new_links.append(new_link(pre_id, 0, ps_id, 1, "CONDITIONING"))
        new_links.append(new_link(ps_id, 0, ds_id, 2, "CONDITIONING"))
        new_links.append(new_link(clip_encode_id, 0, ds_id, 1, "CONDITIONING"))

    new_links.append(lk_clip)

    data["links"] = new_links
    data["last_link_id"] = max(L[0] for L in new_links)

    # Refresh output link id lists on all nodes (derive from links)
    id_to_node = {n["id"]: n for n in data["nodes"]}
    for n in data["nodes"]:
        for o in n.get("outputs", []):
            o["links"] = []

    for L in new_links:
        lid, fn, fs, tn, ts, _typ = L
        outs = id_to_node.get(fn, {}).get("outputs", [])
        if fs < len(outs):
            if outs[fs].get("links") is not None:
                outs[fs]["links"].append(lid)

    # Input link pointers
    for n in data["nodes"]:
        for inp in n.get("inputs", []):
            if "link" in inp:
                inp["link"] = None

    link_by_target: dict[tuple[int, int], int] = {}
    for L in new_links:
        lid, fn, fs, tn, ts, _typ = L
        link_by_target[(tn, ts)] = lid

    for n in data["nodes"]:
        for idx, inp in enumerate(n.get("inputs", [])):
            if "link" not in inp:
                continue
            lid = link_by_target.get((n["id"], idx))
            inp["link"] = lid

    path_out.parent.mkdir(parents=True, exist_ok=True)
    path_out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {path_out} (nodes={len(data['nodes'])}, links={len(data['links'])})")


if __name__ == "__main__":
    inp = Path(sys.argv[1])
    out = Path(sys.argv[2])
    migrate(inp, out)
