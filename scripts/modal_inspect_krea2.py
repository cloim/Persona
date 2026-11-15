"""Modal에서 AI-Toolkit GenerateProcess.py run() 조사용 스크립트."""

import modal

app = modal.App("personas-krea2-inspect")

training_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git")
    .pip_install(
        "torch==2.5.1",
        "torchvision==0.20.1",
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
    timeout=120,
)
def inspect_generate_run():
    from pathlib import Path

    p = Path("/root/ai-toolkit/jobs/process/GenerateProcess.py")
    if p.exists():
        text = p.read_text(encoding="utf-8")
        print("\n=== GenerateProcess.py (121~250줄) ===")
        print("\n".join(text.splitlines()[121:250]))


@app.local_entrypoint()
def main():
    inspect_generate_run.remote()
