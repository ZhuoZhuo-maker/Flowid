#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Flowid RVM Drag Tool

用法：
1) 把 mp4 拖到 exe 上；
2) 在控制台中选择：
   - 1: RVM 抠图 + 合成透明 WebM
   - 2: 仅把 fgr+pha 合成透明 WebM

首次运行会在 exe 同目录生成 rvm_tool_config.json，请按实际路径修改。
"""

from __future__ import annotations

import json
import subprocess
import sys
import traceback
from pathlib import Path


def app_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


APP_DIR = app_dir()
CONFIG_PATH = APP_DIR / "rvm_tool_config.json"
LOG_PATH = APP_DIR / "rvm_tool.log"


DEFAULT_CONFIG = {
    "rvm_root": "F:/flowid/RobustVideoMatting",
    "checkpoint": "F:/flowid/RobustVideoMatting/checkpoints/rvm_mobilenetv3.pth",
    "variant": "mobilenetv3",
    "device": "cuda",
    "python_bin": "python",
    "ffmpeg_bin": "ffmpeg",
    "output_dir": str(APP_DIR).replace("\\", "/"),
}


def ensure_config() -> dict:
    if not CONFIG_PATH.exists():
        CONFIG_PATH.write_text(json.dumps(DEFAULT_CONFIG, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[提示] 已生成配置文件：{CONFIG_PATH}")
        print("[提示] 请先检查 rvm_root / checkpoint 是否正确，再重新运行。")
    try:
        cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        if not isinstance(cfg, dict):
            raise ValueError("配置不是对象")
        merged = {**DEFAULT_CONFIG, **cfg}
        return merged
    except Exception as exc:
        print(f"[错误] 读取配置失败：{exc}")
        return dict(DEFAULT_CONFIG)


def run_cmd(cmd: list[str]) -> None:
    print("\n[执行]", " ".join(cmd))
    proc = subprocess.run(cmd)
    if proc.returncode != 0:
        raise RuntimeError(f"命令执行失败，退出码={proc.returncode}")


def log_line(text: str) -> None:
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(text.rstrip() + "\n")
    except Exception:
        pass


def merge_alpha(ffmpeg_bin: str, fgr_path: Path, pha_path: Path, out_webm: Path) -> None:
    cmd = [
        ffmpeg_bin,
        "-y",
        "-i",
        str(fgr_path),
        "-i",
        str(pha_path),
        "-filter_complex",
        "[0:v][1:v]alphamerge",
        "-c:v",
        "libvpx-vp9",
        "-pix_fmt",
        "yuva420p",
        "-b:v",
        "0",
        "-crf",
        "28",
        str(out_webm),
    ]
    run_cmd(cmd)


def infer_rvm(cfg: dict, input_video: Path, fgr_out: Path, pha_out: Path) -> None:
    rvm_root = Path(str(cfg["rvm_root"])).expanduser()
    inference_py = rvm_root / "inference.py"
    if not inference_py.exists():
        raise FileNotFoundError(f"inference.py 不存在：{inference_py}")
    checkpoint = Path(str(cfg["checkpoint"])).expanduser()
    if not checkpoint.exists():
        raise FileNotFoundError(f"checkpoint 不存在：{checkpoint}")

    cmd = [
        str(cfg["python_bin"]),
        str(inference_py),
        "--variant",
        str(cfg["variant"]),
        "--checkpoint",
        str(checkpoint),
        "--device",
        str(cfg["device"]),
        "--input-source",
        str(input_video),
        "--output-type",
        "video",
        "--output-foreground",
        str(fgr_out),
        "--output-alpha",
        str(pha_out),
    ]
    run_cmd(cmd)


def pick_input_video_from_args() -> Path | None:
    if len(sys.argv) >= 2:
        p = Path(sys.argv[1]).expanduser().resolve()
        if p.exists() and p.suffix.lower() in {".mp4", ".mov", ".mkv", ".webm"}:
            return p
    return None


def ask_path(prompt: str) -> Path:
    raw = input(prompt).strip().strip('"')
    return Path(raw).expanduser().resolve()


def main() -> int:
    print("=== Flowid RVM 拖拽工具 ===")
    log_line("=== Start FlowidRvmTool ===")
    cfg = ensure_config()
    out_dir = Path(str(cfg["output_dir"])).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)

    input_video = pick_input_video_from_args()
    if input_video:
        print(f"[输入视频] {input_video}")
    else:
        print("[提示] 未检测到拖拽输入，你可以手动输入路径。")

    print("\n请选择模式：")
    print("1) RVM 抠图 + 合成透明 WebM")
    print("2) 仅合成透明 WebM（需要已有 fgr/pha）")
    mode = input("输入 1 或 2：").strip()

    try:
        if mode == "1":
            if not input_video:
                input_video = ask_path("请输入输入视频完整路径：")
            if not input_video.exists():
                raise FileNotFoundError(f"输入视频不存在：{input_video}")
            stem = input_video.stem
            fgr_out = out_dir / f"{stem}_fgr.mp4"
            pha_out = out_dir / f"{stem}_pha.mp4"
            webm_out = out_dir / f"{stem}_alpha.webm"
            infer_rvm(cfg, input_video, fgr_out, pha_out)
            merge_alpha(str(cfg["ffmpeg_bin"]), fgr_out, pha_out, webm_out)
            print(f"\n[完成] 输出：{webm_out}")
            log_line(f"[DONE] {webm_out}")
            return 0

        if mode == "2":
            if input_video:
                stem = input_video.stem
                fgr_in = out_dir / f"{stem}_fgr.mp4"
                pha_in = out_dir / f"{stem}_pha.mp4"
                webm_out = out_dir / f"{stem}_alpha.webm"
            else:
                fgr_in = ask_path("请输入 foreground 视频路径（fgr.mp4）：")
                pha_in = ask_path("请输入 alpha 视频路径（pha.mp4）：")
                webm_out = ask_path("请输入输出 webm 路径：")
            if not fgr_in.exists():
                raise FileNotFoundError(f"fgr 不存在：{fgr_in}")
            if not pha_in.exists():
                raise FileNotFoundError(f"pha 不存在：{pha_in}")
            merge_alpha(str(cfg["ffmpeg_bin"]), fgr_in, pha_in, webm_out)
            print(f"\n[完成] 输出：{webm_out}")
            log_line(f"[DONE] {webm_out}")
            return 0

        print("[错误] 无效模式。")
        return 2
    except Exception as exc:
        print(f"\n[失败] {exc}")
        log_line(f"[ERROR] {exc}")
        log_line(traceback.format_exc())
        return 1


if __name__ == "__main__":
    code = 1
    try:
        code = main()
    except Exception as exc:
        print(f"\n[崩溃] {exc}")
        log_line(f"[CRASH] {exc}")
        log_line(traceback.format_exc())
        code = 1
    finally:
        # 打包成 exe 后，避免窗口闪退，留给用户查看报错信息
        if getattr(sys, "frozen", False):
            print("\n按回车键退出...")
            try:
                input()
            except Exception:
                pass
    raise SystemExit(code)

