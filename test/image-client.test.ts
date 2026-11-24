import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { requestImage, saveImage } from "../image-client.ts";

const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNgYGBgAAAABQABeqhXUAAAAABJRU5ErkJggg==",
	"base64",
);
const accessToken = `header.${Buffer.from(JSON.stringify({
	"https://api.openai.com/auth": { chatgpt_account_id: "test-account" },
})).toString("base64url")}.signature`;
const response = { data: [{ b64_json: png.toString("base64") }] };

test("generation sends the Codex request and saves the PNG byte-for-byte", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "pi-image-gen-test-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const signal = new AbortController().signal;
	const image = await requestImage({ prompt: "draw a whale", transparent_background: true }, async () => accessToken, {
		signal,
		fetch: async (url, init) => {
			assert.equal(url, "https://chatgpt.com/backend-api/codex/images/generations");
			assert.equal(init?.method, "POST");
			assert.equal(init?.signal, signal);
			const headers = new Headers(init?.headers);
			assert.equal(headers.get("authorization"), `Bearer ${accessToken}`);
			assert.equal(headers.get("chatgpt-account-id"), "test-account");
			assert.match(headers.get("x-codex-image-turn-id") ?? "", /^[\da-f-]{36}$/);
			assert.deepEqual(JSON.parse(String(init?.body)), {
				prompt: "draw a whale",
				background: "transparent",
				model: "gpt-image-2",
				quality: "auto",
				size: "auto",
			});
			return Response.json(response);
		},
	});
	const path = await saveImage(dir, "session-1", "call_1", image);
	assert.equal(path, join(dir, "generated_images", "session-1", "call_1.png"));
	assert.deepEqual(await readFile(path), png);
	await assert.rejects(saveImage(dir, "session-1", "call_1", image), { code: "EEXIST" });
});

test("editing sends the original files in order and defaults to an opaque background", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "pi-image-gen-test-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const first = join(dir, "previous.png");
	const second = join(dir, "reference.png");
	await writeFile(first, png);
	const other = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8h0AAAAASUVORK5CYII=",
		"base64",
	);
	await writeFile(second, other);
	await requestImage({ prompt: "add a red hat", referenced_image_paths: [second, first] }, async () => accessToken, {
		fetch: async (url, init) => {
			assert.equal(url, "https://chatgpt.com/backend-api/codex/images/edits");
			assert.deepEqual(JSON.parse(String(init?.body)), {
				prompt: "add a red hat",
				images: [
					{ image_url: `data:image/png;base64,${other.toString("base64")}` },
					{ image_url: `data:image/png;base64,${png.toString("base64")}` },
				],
				background: "opaque",
				model: "gpt-image-2",
				quality: "auto",
				size: "auto",
			});
			return Response.json(response);
		},
	});
});

test("invalid paths, absent login, and cancellation don't send an image request", async () => {
	const options = { fetch: async () => assert.fail("unexpected image request") };
	await assert.rejects(requestImage({ prompt: "edit", referenced_image_paths: ["relative.png"] }, async () => accessToken, options), /absolute path/);
	await assert.rejects(requestImage({ prompt: "draw" }, async () => undefined, options), /\/login/);
	const signal = AbortSignal.abort();
	await assert.rejects(requestImage({ prompt: "draw" }, async () => accessToken, { ...options, signal }), { name: "AbortError" });
});

test("quota errors report reset time and empty results fail", async () => {
	await assert.rejects(requestImage({ prompt: "draw" }, async () => accessToken, {
		fetch: async () => Response.json({ error: { type: "usage_limit_reached", resets_at: 1_786_150_800 } }, {
			status: 429,
			headers: { "x-codex-active-limit": "image_gen", "x-codex-imagegen-request-id": "req-test" },
		}),
	}), (error: Error) => /2026-08-08T01:00:00.000Z/.test(error.message) && error.message.includes("req-test"));
	await assert.rejects(requestImage({ prompt: "draw" }, async () => accessToken, {
		fetch: async () => Response.json({ data: [] }),
	}), /no image data/);
});
