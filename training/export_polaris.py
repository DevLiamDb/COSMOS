"""Export Polaris (the fine-tuned COSMOS-Embed model) to ONNX so COSMOS can load it with fastembed.

python training/export_polaris.py <fine-tuned model dir> [out dir, default models/polaris]

Writes model.onnx + the tokenizer files fastembed needs + polaris.json (prefixes and the
version-detection settings measured for this model, read by cosmos/embeddings.py),
then checks that ONNX and PyTorch give the same vectors.
"""
import json
import os
import shutil
import sys

import numpy as np
import onnxruntime as ort
import torch
from transformers import AutoModel, AutoTokenizer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "models", "polaris")
os.makedirs(out, exist_ok=True)

tok = AutoTokenizer.from_pretrained(src)
model = AutoModel.from_pretrained(src).float().eval()
prefixes = json.load(open(os.path.join(src, "cosmos_prefixes.json"), encoding="utf-8"))

sample = tok(["query: test", "passage: un souvenir un peu plus long"], padding=True, return_tensors="pt")
names = ["input_ids", "attention_mask"]  # the XLM-R tokenizer gives no token_type_ids (BertModel defaults them to 0)
axes = {n: {0: "batch", 1: "seq"} for n in names}
axes["last_hidden_state"] = {0: "batch", 1: "seq"}


class Encoder(torch.nn.Module):
    """Keyword call: Transformers 5 forward() takes no positional attention_mask."""
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, input_ids, attention_mask):
        return self.m(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state


torch.onnx.export(Encoder(model), tuple(sample[n] for n in names), os.path.join(out, "model.onnx"),
                  input_names=names, output_names=["last_hidden_state"], dynamic_axes=axes,
                  opset_version=17, dynamo=False)

tok.save_pretrained(out)  # tokenizer.json, tokenizer_config.json
# fastembed also requires special_tokens_map.json, which Transformers 5 no longer writes
json.dump({k: str(v) for k, v in tok.special_tokens_map.items()},
          open(os.path.join(out, "special_tokens_map.json"), "w", encoding="utf-8"), indent=1)
shutil.copy(os.path.join(src, "config.json"), out)
json.dump({
    "name": "Polaris",
    "base": "intfloat/multilingual-e5-small",
    "dim": model.config.hidden_size,
    "query_prefix": prefixes[0],
    "passage_prefix": prefixes[1],
    # measured on the data-cosmos dev groups and the COSMOS benchmark (see cosmos/embeddings.py)
    "supersede_sim": 0.54,
    "supersede_margin": 0.02,
}, open(os.path.join(out, "polaris.json"), "w", encoding="utf-8"), indent=1)


def pooled(h, mask):
    m = mask[..., None].astype(np.float32)
    v = (h * m).sum(1) / m.sum(1)
    return v / np.linalg.norm(v, axis=1, keepdims=True)


texts = ["query: Où est-ce que j'habite maintenant ?", "passage: J'ai déménagé à Gand en mars."]
x = tok(texts, padding=True, return_tensors="np")
sess = ort.InferenceSession(os.path.join(out, "model.onnx"))
onnx_vec = pooled(sess.run(None, {n: x[n].astype(np.int64) for n in names})[0], x["attention_mask"])
ref = AutoModel.from_pretrained(src).float().eval()  # fresh copy: the export leaves `model` patched for tracing
with torch.no_grad():
    pt = ref(**{n: torch.tensor(x[n]) for n in names}).last_hidden_state.numpy()
torch_vec = pooled(pt, x["attention_mask"])
agreement = float((onnx_vec * torch_vec).sum(1).min())
print(f"saved to {out} | ONNX vs PyTorch cosine: {agreement:.6f}")
assert agreement > 0.9999, "ONNX export does not match the PyTorch model"
