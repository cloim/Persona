"""Modal 기반 Personas OMZ Krea 2 Raw LoRA v2 (Reddit 표준 레시피 100% 반영).

Reddit Krea 2 Character LoRA 제작자 표준 스펙:
- Model: Krea 2 Raw (12B MMDiT, convrotint4 4bit 양자화)
- Rank: 32 / Alpha: 32 (안면 이목구비 정체성 각인)
- Dtype: bfloat16 (FP16 기울기 소실 문제 원천 차단)
- EMA: 0.98 (Exponential Moving Average 안정화)
- Learning Rate: 0.0005 (AdamW 8bit)
- Steps: 2,304 Steps (64 Epochs, Batch 1)
- Checkpoints: 매 16 Epoch(576 steps)마다 체크포인트 저장 (576, 1152, 1728, 2304)
"""

import os
import sys
import subprocess
from pathlib import Path
import json

import modal

app = modal.App("personas-krea2-training-v2")

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
def train_krea2_v2(epochs: int = 64, rank: int = 32, lr: float = 0.0005):
    import subprocess
    import re
    import glob
    from pathlib import Path
    import torch

    print("=== Modal 컨테이너 GPU 환경 정보 ===", flush=True)
    gpu_name = torch.cuda.get_device_name(0)
    vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024**3)
    print(f"GPU: {gpu_name} | VRAM: {vram_gb:.1f} GB", flush=True)
    print(f"CUDA: {torch.version.cuda} | PyTorch: {torch.__version__}", flush=True)

    # 1. AI-Toolkit 호환성 패치
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
    num_images = len(images)
    print(f"데이터셋 확인: 이미지 {num_images}장", flush=True)
    assert num_images > 0, "데이터셋 이미지를 찾을 수 없습니다."

    # 64 에포크 기준 총 스텝 수 계산 (batch_size=1)
    total_steps = num_images * epochs
    save_interval = total_steps // 4  # 4번 분할 저장 (16, 32, 48, 64 에포크)
    print(f"총 학습 계획: {epochs} Epochs | 총 {total_steps} Steps (체크포인트 저장 주기: 매 {save_interval} steps)", flush=True)

    # HF_TOKEN 확인
    hf_token = os.environ.get("HF_TOKEN")
    assert hf_token, "HF_TOKEN이 설정되지 않았습니다."
    print("HF_TOKEN 정상 연결 확인 (보안을 위해 값은 출력하지 않습니다).", flush=True)

    # 양자화기 확인
    sys.path.insert(0, "/root/ai-toolkit")
    from toolkit.util.quantize import get_qtype
    assert get_qtype("convrotint4") is not None, "convrotint4 양자화기를 찾을 수 없습니다."
    print("convrotint4 양자화기 확인 완료.", flush=True)

    # Reddit 표준 레시피 Krea 2 LoRA v2 학습 구성 생성
    config = {
        "job": "extension",
        "config": {
            "name": "omz_krea2_v2",
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
                        "dtype": "bfloat16",
                        "save_every": save_interval,
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
                        "steps": total_steps,
                        "gradient_accumulation_steps": 1,
                        "train_unet": True,
                        "train_text_encoder": False,
                        "gradient_checkpointing": True,
                        "cache_text_embeddings": True,
                        "unload_text_encoder": True,
                        "noise_scheduler": "flowmatch",
                        "timestep_type": "linear",
                        "optimizer": "adamw8bit",
                        "lr": lr,
                        "dtype": "bfloat16",
                        "disable_sampling": True,
                        "ema_config": {
                            "use_ema": True,
                            "ema_decay": 0.98
                        }
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
            "version": "2.0"
        }
    }

    config_path = Path("/root/train_config_v2.json")
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")

    runner_path = Path("/root/launch_v2.py")
    runner_path.write_text(
        "import runpy, torch\n"
        "torch.backends.cuda.enable_flash_sdp(False)\n"
        "runpy.run_path('/root/ai-toolkit/run.py', run_name='__main__')\n",
        encoding="utf-8"
    )

    train_env = os.environ.copy()
    train_env["HF_TOKEN"] = hf_token
    train_env["PYTORCH_ALLOC_CONF"] = "expandable_segments:True"

    print(f"=== Krea 2 LoRA v2 학습 개시: Rank {rank}, BF16, EMA 0.98, {total_steps} Steps ===", flush=True)
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
    print("v2 완주 학습 완료 및 Modal Volume 동기화 완료!", flush=True)
    return True


@app.local_entrypoint()
def main(epochs: int = 64, rank: int = 32, lr: float = 0.0005):
    print(f"Modal 클라우드(A10G)에서 Reddit 표준 레시피 기반 Krea 2 LoRA v2 학습을 시작합니다.")
    print(f"스펙: {epochs} Epochs, Rank {rank}, lr {lr}, BF16, EMA 0.98")
    train_krea2_v2.remote(epochs=epochs, rank=rank, lr=lr)
    print("Krea 2 LoRA v2 원격 학습이 성공적으로 완료되었습니다!")
