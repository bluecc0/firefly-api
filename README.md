# firefly-api

轻量级独立 **Adobe Firefly** 反向代理 API 服务，基于 [OmniRoute](https://github.com/cheaper-inference/OmniRoute) 的 Adobe Firefly 核心模块按 MIT 协议抽离二开，零冗余框架依赖。

## 功能特性
- **内置零依赖 Web UI**：启动后直接访问 `http://127.0.0.1:3080`，支持网页端填写/持久化凭证、查看实时点数余额、在线文生图/图生图/视频生成/超分放大
- **文生图**：`POST /v1/images/generations`（Flux 2、Nano Banana / Gemini 3.1、GPT Image 2、Seedream 5.0、Runway Gen-4 等 17 个模型）
- **图生图 / 编辑**：`POST /v1/images/edits`（支持 `multipart/form-data` 和 JSON `image_url` / base64）
- **图片超分放大**：`POST /v1/images/upscale`（Topaz Standard / Topaz Bloom）
- **视频生成**：`POST /v1/videos/generations`（Veo 3.1、Kling v3 / O3、Luma Ray2/3、Runway Gen-4/4.5、Seedance 2.0 等 35 个模型）
- **模型列表**：`GET /v1/models`（支持 `?modality=image|video|upscale` 过滤）
- **额度查询**：`GET /v1/usage`（实时查询 Adobe Firefly 点数余额）
- **凭证热更新 / 多账号透传**：支持 `.env` 配置、`POST /v1/credentials` 热更新，以及请求头 `X-Adobe-Token` / `X-Adobe-Cookie` 按次覆盖

## 快速开始

```bash
cp .env.example .env
# 编辑 .env，填入 ADOBE_FIREFLY_TOKEN（可选填入 ADOBE_FIREFLY_COOKIE）

npm install
npm run dev
```

### 获取 Adobe Firefly Token
1. 浏览器登录 https://firefly.adobe.com
2. 按 `F12` → **Network** → 点击发往 `firefly-3p.ff.adobe.io` 的请求（如 `generate-async` 或 `models/discovery`）
3. 在 **Request Headers** 的 `Authorization` 中复制 `Bearer ` 后面的 JWT（以 `eyJ...` 开头）填入 `.env` 的 `ADOBE_FIREFLY_TOKEN`

## 调用示例

```bash
# 查看模型列表
curl http://127.0.0.1:3080/v1/models?modality=image

# 查询账号点数余额
curl http://127.0.0.1:3080/v1/usage

# 文生图
curl -X POST http://127.0.0.1:3080/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{"model":"flux-2","prompt":"a cyberpunk cat in neon rain","size":"1024x1024"}'

# 图生图 / 编辑（multipart）
curl -X POST http://127.0.0.1:3080/v1/images/edits \
  -F "model=flux-fluxkontextpro" \
  -F "prompt=turn into watercolor painting" \
  -F "image=@./input.png"

# 图片放大
curl -X POST http://127.0.0.1:3080/v1/images/upscale \
  -H "Content-Type: application/json" \
  -d '{"model":"topaz-standard","image_url":"https://example.com/photo.jpg","factor":2}'

# 视频生成
curl -X POST http://127.0.0.1:3080/v1/videos/generations \
  -H "Content-Type: application/json" \
  -d '{"model":"veo-3.1-fast-generate","prompt":"ocean waves at sunset, cinematic"}'
```

## License
MIT License — 核心 Adobe Firefly 协议与会话模块源自 [OmniRoute](https://github.com/cheaper-inference/OmniRoute)（Copyright (c) 2026 diegosouzapw）。
