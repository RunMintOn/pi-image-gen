# AGENTS.md

面向在本仓库工作的 Agent。产品行为见 [README.md](README.md)，首版规格与验收表见 [SPEC.md](SPEC.md)，此处只记代码和规格看不出、但会直接影响改动正确性的结论。

## 安装形态

- 本仓库本身就是一个 Pi package。扩展与 Skill 由 [package.json](package.json) 的 `pi` 字段声明，改动资源位置时同步改这里。
- 用户机器上的登记在 `~/.pi/agent/settings.json` 的 `packages` 数组，值为相对路径 `../../20-dev/20-ecosystems/01-pi/extensions/37-pi-image-gen`。相对路径从 settings 文件所在目录解析。
- 本地包按路径加载，不复制。改完代码 `/reload` 即生效，不需要重装。
- `defaultTools` 只需 `["+codemode"]`。`+tool_search` 不是安装条件，只在同时启用时多一条直接调用的路径。
- 不要改用 `extensions` / `skills` 数组分别登记。两者都受支持，但扩展与 Skill 成对发布，`packages` 是这套资源的正确粒度。

## 调用链与结构化结果

- `image_gen` 以 `exposure: "deferred"` 注册。默认请求里没有它的声明，`codemode` 的工具描述也不列出它。
- 读描述会得出"不可用"的错误结论。实际 `ALL_TOOLS`、`describeTool("image_gen")`、`tools.image_gen(...)` 都可用。`deferred` 工具不受 `defaultTools` 和 `setActiveTools()` 影响。
- 嵌套调用的返回值取决于 `outputSchema`。声明了并有 `structuredContent` 时脚本拿到结构化值，否则只拿到文本。`content` 里的 image 块不会进入脚本。
- 因此 [extension.ts](extension.ts) 必须同时提供 `outputSchema` 与 `structuredContent.image_url`。删掉任一项，脚本就无法预览，只能拿文字。
- 脚本用 `image(result.image_url)` 出预览，用 `text(result.output_hint)` 交出正式路径。预览落盘的是 Pi 的临时副本（`pi-codemode-*.png`），正式产物在 `<agent dir>/generated_images/<session>/`。连续改图必须引用正式路径。
- 不要给调用示例加 `timeout_ms`。它是整个脚本的硬截止，包含等待 worker 和生图时间，超时会丢掉已完成的请求。

## 验证

| 目的 | 命令 | 成本 |
| --- | --- | --- |
| 请求构造、保存、错误分支 | `npm test` | 无网络，约 0.1s |
| 真实生成与编辑各一次 | `node scripts/e2e.mjs` | 消耗订阅额度，E2E 记录路径在输出首行 |

- 断言只读 trace 事件。用历史 trace 重放即可验证断言改动，不需要重跑生图。历史会话的 `generate.jsonl`、`edit.jsonl` 配合 `session.jsonl`（里面逐条有 `content` 与 `nestedCalls`）足以覆盖预览、路径和调用顺序。
- 断言必须落在外层 `codemode` 结果上，用 `parentToolCallId` 关联内层 `image_gen`。只检查内层 `image_gen` 时，脚本漏掉 `image()` 或漏交路径仍然会通过。
- 每阶段只允许一次生图尝试。模型可能先生成一张再重写提示词生成第二张，历史记录里出现过这种情况。
- 真实请求的下游是 ChatGPT 订阅端点。默认模型 `PI_IMAGE_GEN_TEST_MODEL` 指向 `openai-codex/gpt-5.6-luna`，账号无此模型时需另行指定。

## 已踩的坑

- `pi -ne` 会关掉全部内置扩展，包括 `codemode`。用它启动时模型根本没有这个工具，报错表现为"脚本里调不到工具"。要么加 `-e builtin:codemode`，要么别用 `-ne`。
- `--tools` 是白名单，`--exclude-tools` 会进一步收窄。两者都要保留 `codemode`，否则发现流程中断。
- `tool_call` 里的 `block` 判定要在写 trace 之前完成，否则被拦下的重复调用不留记录，测试看不到它发生过。
- 拦截只针对 `image_gen`，不要连 `codemode` 一起拦，否则脚本本身失败，测不出目标行为。

## 未决

- 订阅端点长期可用性未验证。SPEC 已注明直连依赖 Codex 私有接口，可能随上游变化失效。
- 终端图片预览只在 Pi 1.6.0 的交互模式确认过，其他前端未验证。
