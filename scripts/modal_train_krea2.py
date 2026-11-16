"""Modal 기반 범용 Krea 2 Raw LoRA 클라우드 학습 파이프라인 (Reddit 표준 레시피).

어떤 캐릭터라도 데이터셋 폴더와 이름, 트리거 워드만 지정하면 즉시 클라우드 A10G에서 학습을 수행합니다.

주요 특징:
- 동적 데이터셋 전송: 로컬 데이터셋 폴더를 메모리에서 패키징하여 전달하므로 이미지 재빌드 없이 모든 캐릭터 지원
- Reddit 표준 레시피 100% 반영: bfloat16, Rank 32 / Alpha 32, EMA 0.98, lr 5e-4, AdamW 8bit
- 체크포인트 분할 저장: 4분할 균등 저장 (16, 32, 48, 64 Epoch)
- 안전한 Volume 저장 및 선택적 로컬 자동 다운로드

사용 예시:
  # 기본 OMZ 캐릭터 학습
  modal run scripts/modal_train_krea2.py

  # 다른 캐릭터 신규 학습
  modal run scripts/modal_train_krea2.py --name ruby --dataset-dir D:/PROJECTS/Persona/dataset_ruby --trigger-word "ruby character" --epochs 64
"""

import io
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path

import modal

app = modal.App("persona-krea2-training")
output_volume = modal.Volume.from_name("persona-output", create_if_missing=True)

# 기본 학습 이미지 환경 (AI-Toolkit 및 런타임 의존성 사전 구성)
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
)


@app.function(
    image=training_image,
    gpu="A10G",
    memory=32768,
    timeout=7200,
    volumes={"/root/output": output_volume},
    secrets=[modal.Secret.from_name("huggingface")],
)
def train_krea2_remote(
    dataset_bytes: bytes,
    name: str = "omz",
    trigger_word: str = "omz",
    epochs: int = 64,
    rank: int = 32,
    lr: float = 0.0005,
    resolution: int = 512,
):
    import glob
    import os
    import re
    import shutil
    import subprocess
    import sys
    import zipfile
    from pathlib import Path
    import torch

    print(f"=== [Krea 2 LoRA 학습 시작] 캐릭터: {name} (트리거: '{trigger_word}') ===", flush=True)
    gpu_name = torch.cuda.get_device_name(0)
    vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024**3)
    print(f"GPU: {gpu_name} | VRAM: {vram_gb:.1f} GB", flush=True)
    print(f"CUDA: {torch.version.cuda} | PyTorch: {torch.__version__}", flush=True)

    # 1. 전달받은 동적 데이터셋 압축 해제
    dataset_path = Path("/root/dataset")
    if dataset_path.exists():
        shutil.rmtree(dataset_path)
    dataset_path.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(io.BytesIO(dataset_bytes), "r") as zf:
        zf.extractall(dataset_path)

    images = [p for p in dataset_path.iterdir() if p.suffix.lower() in [".png", ".jpg", ".jpeg", ".webp"]]
    num_images = len(images)
    print(f"동적 데이터셋 수신 완료: 이미지 {num_images}장", flush=True)
    assert num_images > 0, "유효한 데이터셋 이미지가 없습니다."

    # 2. AI-Toolkit 호환성 및 VAE 패치 적용
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
            patched_files.append("qwen_vae_dtype_patch")

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

    # mmdit.py sdpa_kernel set_priority 호환성 패치
    for mmdit_file in glob.glob("/root/ai-toolkit/**/mmdit.py", recursive=True):
        p = Path(mmdit_file)
        text = p.read_text(encoding="utf-8")
        if "set_priority=True," in text:
            text = text.replace("set_priority=True,", "")
            p.write_text(text, encoding="utf-8")
            patched_files.append("mmdit_sdpa_patch")
    print(f"호환성 패치 완료: {len(patched_files)}건", flush=True)

    # 3. 학습 스케줄 계산 (Reddit 표준 레시피)
    total_steps = num_images * epochs
    save_interval = max(1, total_steps // 4)
    lora_output_name = f"{name}_krea2"

    print(f"학습 계획: {epochs} Epochs | 총 {total_steps} Steps (체크포인트 저장: 매 {save_interval} steps)", flush=True)

    # HF_TOKEN 확인
    hf_token = os.environ.get("HF_TOKEN")
    assert hf_token, "HF_TOKEN 시크릿이 설정되지 않았습니다."

    # 4. ai-toolkit config.json 생성
    config = {
        "job": "extension",
        "config": {
            "name": lora_output_name,
            "process": [
                {
                    "type": "sd_trainer",
                    "training_folder": "/root/output",
                    "device": "cuda:0",
                    "trigger_word": trigger_word,
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
                            "resolution": [resolution]
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

    print(f"=== {name} Krea 2 LoRA 학습 실행 (Rank {rank}, BF16, EMA 0.98, {total_steps} Steps) ===", flush=True)
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
    print(f"캐릭터 [{name}] 완주 학습 완료 및 Modal Volume 동기화 완료!", flush=True)
    return {
        "success": True,
        "name": name,
        "output_dir": lora_output_name,
        "total_steps": total_steps
    }


def package_dataset_dir(dataset_path: Path) -> bytes:
    """로컬 데이터셋 디렉터리를 메모리 상의 zip 바이트로 패키징합니다."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in dataset_path.iterdir():
            if p.is_file() and p.suffix.lower() in [".png", ".jpg", ".jpeg", ".webp", ".txt", ".json"]:
                zf.write(p, arcname=p.name)
    buf.seek(0)
    return buf.getvalue()


@app.local_entrypoint()
def main(
    name: str = "omz",
    dataset_dir: str = "",
    trigger_word: str = "",
    epochs: int = 64,
    rank: int = 32,
    lr: float = 0.0005,
    resolution: int = 512,
    download: bool = True,
):
    # 1. 데이터셋 디렉터리 경로 자동 감지 및 검증
    if not dataset_dir:
        candidate_paths = [
            Path(f"D:/PROJECTS/Persona/dataset_{name}"),
            Path(f"./dataset_{name}"),
            Path(f"D:/PROJECTS/Persona/dataset"),
            Path("./dataset"),
        ]
        for cp in candidate_paths:
            if cp.exists() and cp.is_dir():
                dataset_path = cp.resolve()
                break
        else:
            print(f"[ERROR] 데이터셋 폴더를 찾을 수 없습니다. --dataset-dir 옵션으로 지정해 주세요.")
            sys.exit(1)
    else:
        dataset_path = Path(dataset_dir).resolve()
        if not dataset_path.exists():
            print(f"[ERROR] 지정된 데이터셋 경로가 존재하지 않습니다: {dataset_path}")
            sys.exit(1)

    if not trigger_word:
        trigger_word = name

    print(f"=== Modal 클라우드 범용 Krea 2 LoRA 학습 설정 ===")
    print(f"  캐릭터 이름: {name}")
    print(f"  트리거 워드: {trigger_word}")
    print(f"  데이터셋 경로: {dataset_path}")
    print(f"  학습 스펙: {epochs} Epochs | Rank {rank} / Alpha {rank} | lr {lr} | 해상도 {resolution} | EMA 0.98")

    # 2. 로컬 데이터셋 패키징
    print(f"로컬 데이터셋 패키징 중...")
    pkg_bytes = package_dataset_dir(dataset_path)
    print(f"패키징 완료: {len(pkg_bytes) / 1024 / 1024:.2f} MB")

    # 3. 원격 클라우드 학습 트리거
    result = train_krea2_remote.remote(
        dataset_bytes=pkg_bytes,
        name=name,
        trigger_word=trigger_word,
        epochs=epochs,
        rank=rank,
        lr=lr,
        resolution=resolution,
    )

    print(f"\n원격 학습이 완료되었습니다! (결과: {result})")

    # 4. 로컬 자동 다운로드 안내
    out_name = f"{name}_krea2"
    print(f"\n[Modal Volume 저장 위치]")
    print(f"  Volume: persona-output")
    print(f"  Path: {out_name}/{out_name}.safetensors")
    print(f"\n[로컬 다운로드 명령어]")
    print(f"  modal volume get persona-output {out_name}/{out_name}.safetensors D:/PROJECTS/Persona/output/{out_name}/{out_name}.safetensors")
    print(f"\n[ComfyMUI 도커 컨테이너 복사 명령어]")
    print(f"  docker cp \"D:/PROJECTS/Persona/output/{out_name}/{out_name}.safetensors\" \"comfymui-comfyui:/data/models/loras/Krea2/{out_name}.safetensors\"")
