docker run -d \
  --name sglang-qwen38 \
  --gpus all \
  --ipc=host \
  --shm-size 32g \
  --memory 118g \
  --memory-swap 118g \
  --security-opt label=disable \
  -v /home/pj/.cache/huggingface:/root/.cache/huggingface \
  -p 8000:8000 \
  sglang:qwen4-stable \
  python3 -m sglang.launch_server \
    --model-path Inferact/Qwen3.8-Flash-Next-NVFP4 \
    --host 0.0.0.0 \
    --port 8000 \
    --tp 1 \
    --quantization modelopt_fp4 \
    --fp4-gemm-backend flashinfer_cutlass \
    --context-length 262144 \
    --mem-fraction-static 0.89 \
    --chunked-prefill-size 4096 \
    --max-running-requests 16 \
    --kv-cache-dtype fp8_e5m2 \
    --tool-call-parser qwen3_coder \
    --reasoning-parser qwen3 \
    --trust-remote-code
