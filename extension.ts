import { readFileSync } from "node:fs";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { MAX_REFERENCES, requestImage, saveImage } from "./image-client.ts";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "image_gen",
		label: "Image generation",
		description: readFileSync(new URL("./imagegen_description.md", import.meta.url), "utf8"),
		exposure: "deferred",
		parameters: Type.Object({
			prompt: Type.String(),
			transparent_background: Type.Optional(Type.Boolean({
				description: "Whether the output should have a transparent background. Defaults to false.",
				default: false,
			})),
			referenced_image_paths: Type.Optional(Type.Union([
				Type.Array(Type.String(), { maxItems: MAX_REFERENCES }),
				Type.Null(),
			])),
		}, { additionalProperties: false }),
		async execute(callId, args, signal, onUpdate, ctx) {
			onUpdate?.({ content: [{ type: "text", text: "Generating image…" }], details: {} });
			const image = await requestImage(args, async () => {
				try {
					return (await ctx.modelRegistry.getProviderAuth("openai-codex"))?.auth.apiKey;
				} catch {
					throw new Error("Could not resolve Pi's OpenAI (ChatGPT Plus/Pro) login. Sign in again with /login.");
				}
			}, { signal });
			const path = await saveImage(getAgentDir(), ctx.sessionManager.getSessionId(), callId, image);
			return {
				content: [
					{ type: "image", data: image.toString("base64"), mimeType: "image/png" },
					{ type: "text", text: `Generated image saved at ${path}` },
				],
				details: { path },
			};
		},
	});
}
