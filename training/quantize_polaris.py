"""Quantized copies of Polaris, for small servers: int8 (dynamic) and int4 (weight-only, blocks of 32).

python training/quantize_polaris.py [polaris dir, default models/polaris]
-> models/polaris-int8/, models/polaris-int4/  (same tokenizer files and polaris.json, smaller model.onnx)

Point COSMOS at one with COSMOS_POLARIS_DIR=models/polaris-int8.
"""
import os
import shutil
import sys

from onnxruntime.quantization import QuantType, quantize_dynamic
from onnxruntime.quantization.matmul_nbits_quantizer import DefaultWeightOnlyQuantConfig, MatMulNBitsQuantizer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "models", "polaris")


def copy_side_files(dst):
    os.makedirs(dst, exist_ok=True)
    for f in os.listdir(src):
        if f != "model.onnx":
            shutil.copy(os.path.join(src, f), dst)


# int8: weights of MatMul and of the embedding table (Gather) stored as int8, activations quantized on the fly
dst8 = os.path.join(ROOT, "models", "polaris-int8")
copy_side_files(dst8)
quantize_dynamic(os.path.join(src, "model.onnx"), os.path.join(dst8, "model.onnx"),
                 weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul", "Gather"],
                 per_channel=True)  # one scale per output channel: cosine to fp32 0.987 instead of 0.957

# int4: weight-only, MatMul and embedding table; ~80% of e5-small's weights are the embedding table
dst4 = os.path.join(ROOT, "models", "polaris-int4")
copy_side_files(dst4)
config = DefaultWeightOnlyQuantConfig(block_size=32, is_symmetric=True, bits=4,
                                      op_types_to_quantize=("MatMul", "Gather"),
                                      quant_axes=(("MatMul", 0), ("Gather", 1)))
q = MatMulNBitsQuantizer(os.path.join(src, "model.onnx"), algo_config=config)
q.process()
q.model.save_model_to_file(os.path.join(dst4, "model.onnx"), use_external_data_format=False)

for d in (src, dst8, dst4):
    print(f"{os.path.basename(d):14} {os.path.getsize(os.path.join(d, 'model.onnx')) / 1e6:7.1f} MB")
