# Pi Image Gen

在 Pi 中生成图片、生成透明 PNG，或用本地图片作为参考进行编辑。Skill 会引导模型通过 `codemode` 脚本调用默认隐藏的 `image_gen`。工具通过 Pi 的 ChatGPT 登录直连 Codex 的生图接口。

## 使用

1. 运行 `pi install git:github.com/RunMintOn/pi-image-gen` 从 GitHub 安装，也可以在本地项目目录运行 `pi install "$PWD"`。
2. 在 Pi 中用 `/login` 登录 **OpenAI (ChatGPT Plus/Pro)**。
3. 确认 `codemode` 已启用（`defaultTools` 里有 `"+codemode"`）。模型从 `codemode` 脚本里用 `tools.image_gen(...)` 调用它。
4. 对 Pi 说「画一张透明背景的橘猫贴纸」。生成后可以接着说「给刚才那只猫加一条红围巾」。

产物保存在 Pi agent 目录的 `generated_images/` 下。工具返回预览和绝对路径。编辑支持 PNG、JPEG 和 WebP 参考图。只有聊天里的粘贴图时，先保存为文件再提供路径。

## 验证

`npm test` 使用本地模拟响应。`node scripts/e2e.mjs` 用当前 Pi 的订阅登录，在独立临时会话中各调用一次真实的生成和编辑。脚本输出工具调用记录的位置。模型可通过 `PI_IMAGE_GEN_TEST_MODEL` 指定。

首版在 Pi 1.6.0 上通过了 4 项本地测试和 2 次真实生图请求。实测模型自行读取 Skill、在 `codemode` 脚本里调用工具，获得透明 PNG，再用返回的路径完成下一轮编辑。两张图均有 alpha 通道。

Skill 和工具说明改编自 [Codex `5e857c65a`](https://github.com/openai/codex/commit/5e857c65a529587c052b656769122b7902e8ed3d)。详见 [首版规格](SPEC.md) 和 [NOTICE](NOTICE)。
