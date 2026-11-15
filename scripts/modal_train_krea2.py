"""Modal 기반 Personas OMZ Krea 2 Raw LoRA 클라우드 학습 파이프라인 (1,000스텝 완주).

사양:
- GPU: NVIDIA A10G (24GB VRAM)
- 시스템 RAM: 32GB
- 데이터셋: 로컬 D:/PROJECTS/Personas/dataset_omz (36장 이미지 + TXT 캡션)
- 출력: Modal Volume (personas-output) 영구 저장 -> 로컬 및 도커 컨테이너 자동 동기화
"""

import os
import sys
import subprocess
from pathlib import Path
import json

import modal

app = modal.App("personas-krea2-training")

output_volume = modal.Volume.from_name("personas-output", create_if_missing=True)

dataset_dir = Path("D:/PROJECTS/Personas/dataset_omz").resolve()

training_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .pip_install(
        "torch==2.5.1",
        "torchvision==0.20.1",
        "torchaudio==2.5.1",
        extra_index_url="https://download.pytorch.org/whl/cu124",
    )
    .run_commands(
        "git clone --filter=blob:none https://github.com/ostris/ai-toolkit.git /root/ai-toolkit",
        "cd /root/ai-toolkit && git checkout d6a18ad72da9abca3ffb67ea8e42c25764eee61a && git submodule update --init --recursive",
        "pip install -r /root/ai-toolkit/requirements.txt",
    )
    .add_local_dir(str(dataset_dir), remote_path="/root/dataset")
)


@app.function(
    image=training_image,
    gpu="A10G",
    memory=32768,
    timeout=7200,
    volumes={"/root/output": output_volume},
    secrets=[modal.Secret.from_name("huggingface")],
)
def train_krea2(steps: int = 1000, rank: int = 8, lr: float = 0.0001):
    import subprocess
    import re
    import glob
    from pathlib import Path
    import torch

    print("=== Modal 컨테이너 환경 정보 ===", flush=True)
    gpu_name = torch.cuda.get_device_name(0)
    vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024**3)
    print(f"GPU: {gpu_name} | VRAM: {vram_gb:.1f} GB", flush=True)
    print(f"CUDA: {torch.version.cuda} | PyTorch: {torch.__version__}", flush=True)

    # PyTorch 2.5 custom_op infer_schema 호환성 패치
    patched_files = []
    for f in glob.glob("/root/ai-toolkit/**/*.py", recursive=True):
        p = Path(f)
        text = p.read_text(encoding="utf-8")
        if "-> list[torch.Tensor]:" in text:
            if "import List" not in text and "from typing import" in text:
                text = text.replace("from typing import ", "from typing import List, ")
            elif "import List" not in text:
                text = "from typing import List\n" + text
            text = text.replace("-> list[torch.Tensor]:", "-> List[torch.Tensor]:")
            p.write_text(text, encoding="utf-8")
            patched_files.append(p.name)

    # Qwen-Image VAE encode dtype 일치 패치 (float32 입력 -> VAE dtype 일치)
    for qwen_vae_file in glob.glob("/root/ai-toolkit/**/qwen_image.py", recursive=True):
        p = Path(qwen_vae_file)
        text = p.read_text(encoding="utf-8")
        if "self.vae.encode(images)" in text:
            text = text.replace("self.vae.encode(images)", "self.vae.encode(images.to(self.vae.dtype))")
            p.write_text(text, encoding="utf-8")
            patched_files.append(p.name + "_dtype_patch")

    # convrot_quant.py Triton JIT _unpack_lane global scope 등록 패치
    for quant_file in glob.glob("/root/ai-toolkit/**/convrot_quant.py", recursive=True):
        p = Path(quant_file)
        text = p.read_text(encoding="utf-8")
        if "def _unpack_lane(" in text and 'globals()["_unpack_lane"]' not in text:
            target = "            return code.to(tl.int8)\n"
            replacement = target + "    globals()[\"_unpack_lane\"] = _unpack_lane\n"
            if target in text:
                text = text.replace(target, replacement, 1)
                p.write_text(text, encoding="utf-8")
                patched_files.append("unpack_lane_global_patch")

    # mmdit.py sdpa_kernel set_priority 호환성 패치 (PyTorch 2.5 호환)
    for mmdit_file in glob.glob("/root/ai-toolkit/**/mmdit.py", recursive=True):
        p = Path(mmdit_file)
        text = p.read_text(encoding="utf-8")
        if "set_priority=True," in text:
            text = text.replace("set_priority=True,", "")
            p.write_text(text, encoding="utf-8")
            patched_files.append("mmdit_sdpa_patch")
    print(f"호환성 및 VAE 패치 완료: {patched_files}", flush=True)

    # 데이터셋 확인
    dataset_path = Path("/root/dataset")
    images = [p for p in dataset_path.iterdir() if p.suffix.lower() in [".png", ".jpg", ".jpeg", ".webp"]]
    print(f"데이터셋 확인: 이미지 {len(images)}장", flush=True)
    assert len(images) > 0, "데이터셋 이미지를 찾을 수 없습니다."

    # HF_TOKEN 확인 (값은 절대 출력하지 않음)
    hf_token = os.environ.get("HF_TOKEN")
    assert hf_token, "HF_TOKEN이 설정되지 않았습니다. Modal secret을 확인해 주세요."
    print("HF_TOKEN 정상 연결 확인 (보안을 위해 값은 출력하지 않습니다).", flush=True)

    # 양자화기 확인
    sys.path.insert(0, "/root/ai-toolkit")
    from toolkit.util.quantize import get_qtype
    assert get_qtype("convrotint4") is not None, "convrotint4 양자화기를 찾을 수 없습니다."
    print("convrotint4 양자화기 확인 완료.", flush=True)

    # Krea 2 Raw 1,000스텝 완주 학습 구성 생성
    config = {
        "job": "extension",
        "config": {
            "name": "omz_krea2_modal",
            "process": [
                {
                    "type": "sd_trainer",
                    "training_folder": "/root/output",
                    "device": "cuda:0",
                    "trigger_word": "omz",
                    "network": {
                        "type": "lora",
                        "linear": rank,
                        "linear_alpha": rank
                    },
                    "save": {
                        "dtype": "float16",
                        "save_every": 250,
                        "max_step_saves_to_keep": 4,
                        "push_to_hub": False
                    },
                    "datasets": [
                        {
                            "folder_path": "/root/dataset",
                            "caption_ext": "txt",
                            "caption_dropout_rate": 0.05,
                            "shuffle_tokens": False,
                            "cache_latents_to_disk": True,
                            "cache_text_embeddings": True,
                            "resolution": [512]
                        }
                    ],
                    "train": {
                        "batch_size": 1,
                        "steps": steps,
                        "gradient_accumulation_steps": 4,
                        "train_unet": True,
                        "train_text_encoder": False,
                        "gradient_checkpointing": True,
                        "cache_text_embeddings": True,
                        "unload_text_encoder": True,
                        "noise_scheduler": "flowmatch",
                        "timestep_type": "linear",
                        "optimizer": "adamw8bit",
                        "lr": lr,
                        "dtype": "float16",
                        "disable_sampling": True
                    },
                    "model": {
                        "name_or_path": "krea/Krea-2-Raw",
                        "arch": "krea2",
                        "quantize": True,
                        "quantize_te": True,
                        "low_vram": True,
                        "qtype": "convrotint4",
                        "qtype_te": "convrotint4",
                        "vae_dtype": "float32",
                        "model_kwargs": {
                            "max_text_length": 256
                        }
                    }
                }
            ]
        },
        "meta": {
            "name": "[name]",
            "version": "1.0"
        }
    }

    config_path = Path("/root/train_config.json")
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")

    runner_path = Path("/root/launch.py")
    runner_path.write_text(
        "import runpy, torch\n"
        "torch.backends.cuda.enable_flash_sdp(False)\n"
        "runpy.run_path('/root/ai-toolkit/run.py', run_name='__main__')\n",
        encoding="utf-8"
    )

    train_env = os.environ.copy()
    train_env["HF_TOKEN"] = hf_token
    train_env["PYTORCH_ALLOC_CONF"] = "expandable_segments:True"

    print(f"Krea 2 Raw AI-Toolkit {steps}스텝 완주 학습을 시작합니다...", flush=True)
    process = subprocess.Popen(
        [sys.executable, "-u", str(runner_path), str(config_path)],
        cwd="/root/ai-toolkit",
        env=train_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )

    try:
        for line in process.stdout:
            sanitized = re.sub(r'hf_[A-Za-z0-9]+', '[HF_TOKEN]', line)
            print(sanitized, end="", flush=True)
        ret = process.wait()
    except KeyboardInterrupt:
        process.terminate()
        process.wait(timeout=30)
        raise

    assert ret == 0, f"학습 실패 (종료 코드: {ret})"

    output_volume.commit()
    print("1,000스텝 완주 학습 완료 및 Modal Volume 동기화 완료!", flush=True)
    return True


@app.local_entrypoint()
def main(steps: int = 1000, rank: int = 8, lr: float = 0.0001):
    print(f"Modal 클라우드(A10G)에서 Krea 2 Raw LoRA {steps}스텝 완주 학습을 시작합니다. (rank: {rank}, lr: {lr})")
    train_krea2.remote(steps=steps, rank=rank, lr=lr)
    print("원격 학습이 성공적으로 완료되었습니다!")
