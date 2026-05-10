#!/usr/bin/env python3
"""
将 ComfyUI API 格式 JSON 中的 TTResolutionSelector 改为使用自定义宽高占位符，
与 Flowid 客户端注入的 __WIDTH__ / __HEIGHT__ 对齐。

用法:
  python tools/patch_workflow_api_ttresolution.py "F:/path/to/工作流api"
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def patch_workflow(data: dict) -> bool:
    changed = False
    for _nid, node in data.items():
        if not isinstance(node, dict):
            continue
        if node.get("class_type") != "TTResolutionSelector":
            continue
        inp = node.setdefault("inputs", {})
        if (
            inp.get("use_custom_resolution") is True
            and inp.get("custom_width") == "__WIDTH__"
            and inp.get("custom_height") == "__HEIGHT__"
        ):
            continue
        inp["use_custom_resolution"] = True
        inp["custom_width"] = "__WIDTH__"
        inp["custom_height"] = "__HEIGHT__"
        changed = True
    return changed


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    if not root.is_dir():
        print(f"Not a directory: {root}", file=sys.stderr)
        sys.exit(1)
    for path in sorted(root.glob("*.json")):
        try:
            raw = path.read_text(encoding="utf-8")
            data = json.loads(raw)
        except Exception as e:
            print(f"skip {path.name}: {e}")
            continue
        if not isinstance(data, dict):
            continue
        if not patch_workflow(data):
            continue
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"patched {path.name}")


if __name__ == "__main__":
    main()
