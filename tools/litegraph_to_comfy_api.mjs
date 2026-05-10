/**
 * One-off / utility: ComfyUI LiteGraph workflow JSON -> API prompt JSON.
 * Usage: node tools/litegraph_to_comfy_api.mjs <input.json>
 */
import fs from "fs";

const path = process.argv[2];
const outPath = process.argv[3];
if (!path) {
  console.error(
    "Usage: node tools/litegraph_to_comfy_api.mjs <workflow.json> [out.json]",
  );
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(path, "utf8"));
const linkById = {};
for (const L of raw.links || []) {
  const [linkId, fromNode, fromSlot, toNode, toSlot] = L;
  linkById[linkId] = { fromNode, fromSlot, toNode, toSlot };
}

function isSeedControl(v) {
  return (
    typeof v === "string" &&
    (v === "fixed" || v === "randomize" || v === "increment" || v === "decrement")
  );
}

const prompt = {};
for (const node of raw.nodes || []) {
  const id = String(node.id);
  const inputs = {};
  const wv = node.widgets_values || [];
  let wi = 0;

  const takeWidget = (inpName) => {
    if (wi >= wv.length) {
      if (inpName === "audioUI") return "";
      return undefined;
    }
    return wv[wi++];
  };

  for (let slotIndex = 0; slotIndex < (node.inputs || []).length; slotIndex++) {
    const inp = node.inputs[slotIndex];
    const name = inp.name;
    if (inp.link != null) {
      const L = linkById[inp.link];
      if (!L) continue;
      inputs[name] = [String(L.fromNode), L.fromSlot];
      continue;
    }
    if (!inp.widget) continue;

    if (name === "seed" && wi + 1 < wv.length && isSeedControl(wv[wi + 1])) {
      inputs[name] = wv[wi++];
      wi++;
      continue;
    }

    const v = takeWidget(name);
    if (v !== undefined) inputs[name] = v;
  }

  prompt[id] = {
    inputs,
    class_type: node.type,
    _meta: {
      title:
        (node.properties && node.properties["Node name for S&R"]) || node.type,
    },
  };
}

const text = JSON.stringify(prompt, null, 2);
if (outPath) fs.writeFileSync(outPath, text, "utf8");
else process.stdout.write(text);
