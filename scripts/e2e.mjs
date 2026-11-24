import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "pi-image-gen-e2e-"));
console.log(`E2E records: ${work}`);

function prompt(phase, message) {
	const trace = join(work, `${phase}.jsonl`);
	const run = spawnSync("pi", [
		"--offline", "--no-approve", "--no-context-files", "--no-mcp", "-ne", "-ns",
		"-e", root, "-e", join(root, "scripts/e2e-trace.ts"), "-e", "builtin:codemode",
		"--skill", join(root, "skills/imagegen"), "--tools", "+codemode",
		"--exclude-tools", "bash,powershell,edit,write,grep,find,ls",
		"--model", process.env.PI_IMAGE_GEN_TEST_MODEL ?? "openai-codex/gpt-5.6-luna",
		"--session", join(work, "session.jsonl"),
		"--thinking", "low", "-p", message,
	], { cwd: work, env: { ...process.env, PI_IMAGE_GEN_TEST_TRACE: trace }, stdio: "inherit", timeout: 300_000 });
	if (run.error) throw run.error;
	assert.equal(run.status, 0);
	return readFileSync(trace, "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

function imageResult(events) {
	const calls = events.filter((event) => event.kind === "call" && event.name === "image_gen");
	assert.equal(calls.length, 1, "expected exactly one image_gen attempt per phase");
	const [call] = calls;
	assert.ok(call.parentToolCallId, "expected a nested image_gen call");
	const result = events.find((event) => event.kind === "result" && event.name === "image_gen" && event.toolCallId === call.toolCallId);
	assert.ok(result, "missing image_gen result");
	assert.equal(result.isError, false, result.text.join("\n"));
	assert.deepEqual(result.mimeTypes, ["image/png"]);
	const path = result.details.path;

	const preview = events.find((event) => event.kind === "result" && event.name === "codemode" && event.toolCallId === call.parentToolCallId);
	assert.ok(preview, "missing codemode result for the image_gen call");
	assert.equal(preview.isError, false, preview.text.join("\n"));
	assert.deepEqual(preview.mimeTypes, ["image/png"], "expected one PNG preview in the codemode result");
	assert.ok(preview.text.some((text) => text.includes(path)), "codemode did not output the saved image path");

	const bytes = readFileSync(path);
	assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
	return { call, path, bytes };
}

const generate = prompt("generate", "请生成一张透明背景 PNG。只要一张，画一只扁平矢量插画风格的黄色橡皮鸭，独立居中，直接给我预览。");
assert.equal(generate.find((event) => event.kind === "request").imageDeclaration, null);
assert.equal(generate.some((event) => event.name === "tool_search"), false);
const original = imageResult(generate);
const read = generate.findIndex((event) => event.kind === "call" && event.name === "read" && event.args.path.endsWith("/skills/imagegen/SKILL.md"));
assert.ok(read >= 0 && generate.indexOf(original.call) > read, "expected the Skill to be read before image generation");
assert.equal(original.call.args.transparent_background, true);
assert.equal(original.call.args.referenced_image_paths?.length ?? 0, 0);
assert.ok([4, 6].includes(original.bytes[25]), "expected a PNG with an alpha channel");

const edit = prompt("edit", "请给刚才生成的那只橡皮鸭加一顶红色小帽子，其余保持原样，仍要透明背景。只要一张，直接给我预览。");
const revision = imageResult(edit);
assert.deepEqual(revision.call.args.referenced_image_paths, [original.path]);
assert.equal(revision.call.args.transparent_background, true);
assert.notEqual(revision.path, original.path);
assert.ok([4, 6].includes(revision.bytes[25]), "expected the edited PNG to retain an alpha channel");
console.log(`Original: ${original.path}\nEdit: ${revision.path}`);
