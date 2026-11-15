"""Modal 기반 Personas LoRA 클라우드 학습 파이프라인.

지원 모델:
- Krea 2 Raw (krea2)
- FLUX.1 dev (flux1dev)
- Qwen-Image-2.1 (qwen21)

클라우드 사양:
- GPU: NVIDIA A10G (24GB VRAM)
- 시스템 RAM: 32GB
- 출력: Modal Volume (personas-output) 및 로컬 자동 다운로드
"""

import os
import sys
import io
import json
import zipfile
from pathlib import Path

import modal

app = modal.App("personas-training")

output_volume = modal.Volume.from_name("personas-output", create_if_missing=True)

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


MODEL_PROFILES = {
    "krea2": {
        "checkpoint": "krea/Krea-2-Raw",
        "arch": "krea2",
        "timestep": "linear",
        "guidance": 3.5,
        "sample_steps": 28,
        "model_kwargs": {"max_text_length": 256},
    },
    "flux1dev": {
        "checkpoint": "black-forest-labs/FLUX.1-dev",
        "arch": "flux",
        "is_flux": True,
        "timestep": "sigmoid",
        "guidance": 4.0,
        "sample_steps": 20,
    },
    "qwen21": {
        "checkpoint": "Comfy-Org/Qwen-Image-2.1",
        "arch": "qwen_image_2",
        "timestep": "shift",
        "guidance": 3.0,
        "sample_steps": 28,
        "model_kwargs": {"rgba": False},
    },
    "moss": {
        "checkpoint": "OpenMOSS-Team/MOSS-Image-Base",
        "arch": "moss_image",
        "timestep": "flowmatch",
        "guidance": 3.0,
        "sample_steps": 28,
        "model_kwargs": {"uncond_skip_layers": [22]},
    },
}


def build_training_config(model_id: str, trigger: str, steps: int = 1000, rank: int = 8, lr: float = 0.0001) -> dict:
    profile = MODEL_PROFILES.get(model_id, MODEL_PROFILES["krea2"])
    clean_trigger = "".join(c for c in trigger if c.isalnum() or c in ("_", "-")) or "character"
    job_name = f"{clean_trigger}_{model_id}_modal"

    model_conf = {
        "name_or_path": profile["checkpoint"],
        "arch": profile["arch"],
        "quantize": True,
        "quantize_te": True,
        "low_vram": True,
        "qtype": "convrotint4",
        "qtype_te": "convrotint4",
        "vae_dtype": "float32",
    }
    if profile.get("is_flux"):
        model_conf["is_flux"] = True
    if "model_kwargs" in profile:
        model_conf["model_kwargs"] = profile["model_kwargs"]

    return {
        "job": "extension",
        "config": {
            "name": job_name,
            "process": [
                {
                    "type": "sd_trainer",
                    "training_folder": "/root/output",
                    "device": "cuda:0",
                    "trigger_word": clean_trigger,
                    "network": {
                        "type": "lora",
                        "linear": rank,
                        "linear_alpha": rank,
                    },
                    "save": {
                        "dtype": "float16",
                        "save_every": max(100, steps // 4),
                        "max_step_saves_to_keep": 2,
                        "push_to_hub": False,
                    },
                    "datasets": [
                        {
                            "folder_path": "/root/dataset",
                            "caption_ext": "txt",
                            "caption_dropout_rate": 0.05,
                            "shuffle_tokens": False,
                            "cache_latents_to_disk": True,
                            "cache_text_embeddings": True,
                            "resolution": [512],
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
                        "timestep_type": profile["timestep"],
                        "optimizer": "adamw8bit",
                        "lr": lr,
                        "dtype": "float16",
                        "disable_sampling": True,
                    },
                    "model": model_conf,
                    "sample": {
                        "sampler": "flowmatch",
                        "sample_every": max(250, steps // 4),
                        "width": 512,
                        "height": 512,
                        "prompts": [f"{clean_trigger}, a portrait in soft daylight"],
                        "seed": 42,
                        "walk_seed": False,
                        "guidance_scale": profile["guidance"],
                        "sample_steps": profile["sample_steps"],
                    },
                }
            ],
        },
        "meta": {"name": "[name]", "version": "1.0"},
    }


@app.function(
    image=training_image,
    gpu="A10G",
    memory=32768,
    timeout=7200,
    volumes={"/root/output": output_volume},
    secrets=[modal.Secret.from_name("huggingface")],
)
def train_lora(
    dataset_zip_bytes: bytes,
    trigger: str = "character",
    model_id: str = "krea2",
    steps: int = 1000,
    rank: int = 8,
    lr: float = 0.0001,
) -> dict:
    import glob
    import re
    import shutil
    import subprocess
    from pathlib import Path
    from PIL import Image
    import torch

    print("=== Modal GPU 컨테이너 환경 정보 ===", flush=True)
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
    if patched_files:
        print(f"PyTorch 호환성 패치 완료 ({len(patched_files)}개 파일)", flush=True)

    # 데이터셋 압축 풀기
    dataset_path = Path("/root/dataset")
    if dataset_path.exists():
        shutil.rmtree(dataset_path)
    dataset_path.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(io.BytesIO(dataset_zip_bytes)) as zf:
        zf.extractall(dataset_path)

    # WebP를 PNG로 변환 (AI Toolkit 권장 포맷 일치)
    raw_images = [
        p for p in dataset_path.iterdir() if p.suffix.lower() in [".png", ".jpg", ".jpeg", ".webp"]
    ]
    for img_p in raw_images:
        if img_p.suffix.lower() == ".webp":
            png_p = img_p.with_suffix(".png")
            Image.open(img_p).convert("RGB").save(png_p)
            img_p.unlink()

    images = [
        p for p in dataset_path.iterdir() if p.suffix.lower() in [".png", ".jpg", ".jpeg"]
    ]
    print(f"데이터셋 검증 완료: 유효 이미지 {len(images)}장", flush=True)
    assert len(images) > 0, "데이터셋 이미지를 찾을 수 없습니다."

    # HF_TOKEN 확인 (값은 보안상 절대 출력하지 않음)
    hf_token = os.environ.get("HF_TOKEN")
    if model_id in ("flux1dev", "krea2"):
        assert hf_token, "HF_TOKEN이 필요합니다. Modal secrets에 huggingface가 등록되어 있는지 확인해 주세요."
    print("HF_TOKEN 자격 증명 확인 완료.", flush=True)

    # 양자화기 확인
    sys.path.insert(0, "/root/ai-toolkit")
    from toolkit.util.quantize import get_qtype
    assert get_qtype("convrotint4") is not None, "convrotint4 양자화기를 찾을 수 없습니다."

    # 설정 파일 생성
    config = build_training_config(model_id, trigger, steps=steps, rank=rank, lr=lr)
    config_path = Path("/root/train_config.json")
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")

    runner_path = Path("/root/launch.py")
    runner_path.write_text(
        "import runpy, torch\n"
        "torch.backends.cuda.enable_flash_sdp(False)\n"
        "runpy.run_path('/root/ai-toolkit/run.py', run_name='__main__')\n",
        encoding="utf-8",
    )

    train_env = os.environ.copy()
    if hf_token:
        train_env["HF_TOKEN"] = hf_token
    train_env["PYTORCH_ALLOC_CONF"] = "expandable_segments:True"

    clean_trigger = "".join(c for c in trigger if c.isalnum() or c in ("_", "-")) or "character"
    print(f"[Modal] {model_id} LoRA 학습 시작: 트리거='{clean_trigger}', 스텝={steps}, rank={rank}", flush=True)

    process = subprocess.Popen(
        [sys.executable, "-u", str(runner_path), str(config_path)],
        cwd="/root/ai-toolkit",
        env=train_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    try:
        for line in process.stdout:
            sanitized = re.sub(r"hf_[A-Za-z0-9]+", "[HF_TOKEN]", line)
            print(sanitized, end="", flush=True)
        ret = process.wait()
    except KeyboardInterrupt:
        process.terminate()
        process.wait(timeout=30)
        raise

    assert ret == 0, f"학습 실패 (종료 코드: {ret})"

    output_volume.commit()
    print("Modal Volume 영구 저장 완료.", flush=True)

    # 생성된 LoRA 파일 검색
    out_dir = Path("/root/output")
    job_folder = out_dir / f"{clean_trigger}_{model_id}_modal"
    safetensors = sorted(job_folder.rglob("*.safetensors"), key=lambda p: p.stat().st_mtime)
    if not safetensors:
        safetensors = sorted(out_dir.rglob("*.safetensors"), key=lambda p: p.stat().st_mtime)

    assert safetensors, "학습 완료 후 생성된 .safetensors 파일을 찾지 못했습니다."
    latest_lora = safetensors[-1]
    lora_bytes = latest_lora.read_bytes()
    print(f"LoRA 산출물 생성 확인: {latest_lora.name} ({len(lora_bytes) / 1024**2:.1f} MB)", flush=True)

    return {
        "filename": latest_lora.name,
        "size_bytes": len(lora_bytes),
        "data": lora_bytes,
        "trigger": clean_trigger,
        "model_id": model_id,
        "steps": steps,
    }


@app.local_entrypoint()
def main(
    dataset_dir: str = "D:/PROJECTS/Personas/dataset_omz",
    model: str = "krea2",
    trigger: str = "omz",
    steps: int = 1000,
    rank: int = 8,
    lr: float = 0.0001,
    output_dir: str = "D:/PROJECTS/Personas/output",
):
    print(f"=== Modal LoRA 클라우드 학습 자동화 ===")
    print(f"데이터셋: {dataset_dir} | 모델: {model} | 트리거: {trigger} | 스텝: {steps}")

    local_path = Path(dataset_dir).resolve()
    assert local_path.is_dir(), f"데이터셋 폴더를 찾을 수 없습니다: {local_path}"

    # 로컬 데이터셋을 ZIP으로 메모리 패키징
    buf = io.BytesIO()
    count = 0
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for p in local_path.iterdir():
            if p.is_file() and p.suffix.lower() in [".png", ".jpg", ".jpeg", ".webp", ".txt"]:
                zf.write(p, arcname=p.name)
                count += 1
    assert count > 0, "데이터셋 폴더에 이미지나 txt 캡션이 없습니다."
    zip_bytes = buf.getvalue()
    print(f"로컬 파일 {count}개 패키징 완료 ({len(zip_bytes) / 1024:.1f} KB). Modal A10G로 전송합니다...")

    # Modal 원격 함수 호출
    result = train_lora.remote(
        dataset_zip_bytes=zip_bytes,
        trigger=trigger,
        model_id=model,
        steps=steps,
        rank=rank,
        lr=lr,
    )

    # 결과 LoRA 로컬 저장
    out_path = Path(output_dir).resolve()
    out_path.mkdir(parents=True, exist_ok=True)
    saved_file = out_path / result["filename"]
    saved_file.write_bytes(result["data"])

    print(f"\n[성공] 원격 학습이 완료되었으며 로컬에 저장되었습니다!")
    print(f"저장 위치: {saved_file} ({result['size_bytes'] / 1024**2:.1f} MB)")
