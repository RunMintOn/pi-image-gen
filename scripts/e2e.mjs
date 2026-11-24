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
		"-e", root, "-e", "builtin:tool-search", "-e", join(root, "scripts/e2e-trace.ts"),
		"--skill", join(root, "skills/imagegen"), "--tools", "+tool_search",
		"--exclude-tools", "bash,powershell,edit,write,grep,find,ls,codemode",
		"--model", process.env.PI_IMAGE_GEN_TEST_MODEL ?? "openai-codex/gpt-5.6-luna",
		"--session", join(work, "session.jsonl"),
		"--thinking", "low", "-p", message,
	], { cwd: work, env: { ...process.env, PI_IMAGE_GEN_TEST_TRACE: trace }, stdio: "inherit", timeout: 300_000 });
	if (run.error) throw run.error;
	assert.equal(run.status, 0);
	return readFileSync(trace, "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

function imagePath(events) {
	const results = events.filter((event) => event.kind === "result");
	assert.equal(results.length, 1, JSON.stringify(results));
	const [result] = results;
	assert.equal(result.isError, false, result.text.join("\n"));
	assert.deepEqual(result.mimeTypes, ["image/png"]);
	const path = result.details.path;
	const bytes = readFileSync(path);
	assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
	return { path, bytes };
}

const generate = prompt("generate", "请生成一张透明背景 PNG。只要一张，画一只扁平矢量插画风格的黄色橡皮鸭，独立居中，直接给我预览。");
assert.equal(generate.find((event) => event.kind === "request").imageDeclaration, null);
const read = generate.findIndex((event) => event.name === "read" && event.args.path.endsWith("/skills/imagegen/SKILL.md"));
const search = generate.findIndex((event) => event.name === "tool_search");
const create = generate.findIndex((event) => event.name === "image_gen");
assert.ok(read >= 0 && search > read && create > search, "expected Skill → search → image generation");
const declaration = generate.find((event) => event.imageDeclaration)?.imageDeclaration;
assert.equal(declaration?.description, readFileSync(join(root, "imagegen_description.md"), "utf8"));
assert.deepEqual(Object.keys(declaration.parameters.properties).sort(), ["prompt", "referenced_image_paths", "transparent_background"]);
assert.deepEqual(declaration.parameters.required, ["prompt"]);
assert.equal(generate[create].args.transparent_background, true);
assert.equal(generate[create].args.referenced_image_paths?.length ?? 0, 0);
const original = imagePath(generate);
assert.ok([4, 6].includes(original.bytes[25]), "expected a PNG with an alpha channel");

const edit = prompt("edit", "请给刚才生成的那只橡皮鸭加一顶红色小帽子，其余保持原样，仍要透明背景。只要一张，直接给我预览。");
const editCall = edit.find((event) => event.name === "image_gen");
assert.deepEqual(editCall?.args.referenced_image_paths, [original.path]);
assert.equal(editCall.args.transparent_background, true);
const revision = imagePath(edit);
assert.notEqual(revision.path, original.path);
assert.ok([4, 6].includes(revision.bytes[25]), "expected the edited PNG to retain an alpha channel");
console.log(`Original: ${original.path}\nEdit: ${revision.path}`);
