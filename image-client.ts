import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

const BASE_URL = "https://chatgpt.com/backend-api/codex/images";
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
export const MAX_REFERENCES = 5;

export interface ImageArgs {
	prompt: string;
	transparent_background?: boolean;
	referenced_image_paths?: string[] | null;
}

function imageMime(bytes: Buffer): string | undefined {
	if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
	if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
}

async function loadReference(path: string, signal?: AbortSignal) {
	if (!isAbsolute(path)) throw new Error(`Use an absolute path for the reference image: ${path}`);
	let bytes: Buffer;
	try {
		bytes = await readFile(path, { signal });
	} catch {
		signal?.throwIfAborted();
		throw new Error(`Unable to read referenced image: ${path}`);
	}
	const mime = imageMime(bytes);
	if (!mime) throw new Error(`Use a PNG, JPEG, or WebP reference image: ${path}`);
	return { image_url: `data:${mime};base64,${bytes.toString("base64")}` };
}

function accountId(accessToken: string): string {
	try {
		const payload = accessToken.split(".")[1];
		const id: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))?.["https://api.openai.com/auth"]?.chatgpt_account_id;
		if (typeof id === "string" && id) return id;
	} catch {
		// Pi's OAuth provider derives the account from the same token claim.
	}
	throw new Error("Unable to read the ChatGPT account from Pi's login. Sign in again with /login.");
}

function quotaReset(response: Response, body: unknown): string | undefined {
	const limit = response.headers.get("x-codex-active-limit");
	const prefix = limit === "image_gen" ? "x-image-gen" : limit === "imagegen_premium" ? "x-imagegen-premium" : undefined;
	if (!prefix) return;
	const error = (body as { error?: { type?: string; resets_at?: number } } | null)?.error;
	if (error?.type !== "usage_limit_reached") return;
	const windows = ["primary", "secondary"]
		.filter((window) => Number(response.headers.get(`${prefix}-${window}-used-percent`)) >= 100)
		.map((window) => Number(response.headers.get(`${prefix}-${window}-reset-at`)));
	const seconds = error.resets_at ?? Math.max(0, ...windows);
	const date = new Date(seconds * 1000);
	if (seconds > 0 && Number.isFinite(date.getTime())) return date.toISOString();
}

export async function requestImage(
	args: ImageArgs,
	resolveAccessToken: () => Promise<string | undefined>,
	{ signal, fetch: fetchImage = fetch }: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<Buffer> {
	signal?.throwIfAborted();
	const paths = args.referenced_image_paths ?? [];
	if (paths.length > MAX_REFERENCES) throw new Error(`Use at most ${MAX_REFERENCES} reference images.`);
	const images = [];
	for (const path of paths) images.push(await loadReference(path, signal));

	const token = await resolveAccessToken();
	signal?.throwIfAborted();
	if (!token) throw new Error("Sign in to OpenAI (ChatGPT Plus/Pro) in Pi with /login.");
	const account = accountId(token);
	let response: Response;
	try {
		response = await fetchImage(`${BASE_URL}/${images.length ? "edits" : "generations"}`, {
			method: "POST",
			redirect: "error",
			signal,
			headers: {
				authorization: `Bearer ${token}`,
				"chatgpt-account-id": account,
				"content-type": "application/json",
				"x-codex-image-turn-id": randomUUID(),
			},
			body: JSON.stringify({
				...(images.length ? { images } : {}),
				prompt: args.prompt,
				background: args.transparent_background ? "transparent" : "opaque",
				model: "gpt-image-2",
				quality: "auto",
				size: "auto",
			}),
		});
	} catch {
		signal?.throwIfAborted();
		throw new Error("Could not reach the Codex image endpoint.");
	}
	const body = await response.json().catch(() => null);
	signal?.throwIfAborted();
	const requestId = response.headers.get("x-codex-imagegen-request-id");
	const suffix = requestId && /^[\w-]{1,128}$/.test(requestId) ? ` (image request ID ${requestId})` : "";
	if (!response.ok) {
		if (response.status === 429) {
			const reset = quotaReset(response, body);
			throw new Error(`Image generation is rate limited.${reset ? ` Quota resets at ${reset}.` : ""}${suffix}`);
		}
		const loginHint = response.status === 401 ? " Check your Pi login with /login." : "";
		throw new Error(`Codex image request failed (HTTP ${response.status}).${loginHint}${suffix}`);
	}
	const data: unknown = body?.data?.[0]?.b64_json;
	if (typeof data !== "string" || !data.trim()) throw new Error(`Codex returned no image data.${suffix}`);
	const image = Buffer.from(data, "base64");
	if (imageMime(image) !== "image/png") throw new Error(`Codex did not return a PNG image.${suffix}`);
	return image;
}

export async function saveImage(agentDir: string, sessionId: string, callId: string, image: Buffer): Promise<string> {
	const safe = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_") || "image";
	const path = resolve(agentDir, "generated_images", safe(sessionId), `${safe(callId)}.png`);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, image, { flag: "wx" });
	return path;
}
