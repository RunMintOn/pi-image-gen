import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function imageDeclaration(value: unknown): unknown {
	if (Array.isArray(value)) {
		for (const item of value) {
			const match = imageDeclaration(item);
			if (match) return match;
		}
	} else if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		if (record.type === "function" && record.name === "image_gen") return record;
		for (const item of Object.values(record)) {
			if (item && typeof item === "object") {
				const match = imageDeclaration(item);
				if (match) return match;
			}
		}
	}
}

export default function (pi: ExtensionAPI) {
	const path = process.env.PI_IMAGE_GEN_TEST_TRACE;
	if (!path) throw new Error("Set PI_IMAGE_GEN_TEST_TRACE.");
	const log = (event: object) => appendFileSync(path, `${JSON.stringify(event)}\n`);
	let attemptedImageCall = false;
	pi.on("before_provider_request", (event) => {
		log({ kind: "request", imageDeclaration: imageDeclaration(event.payload) ?? null });
	});
	pi.on("tool_call", (event) => {
		if (event.toolName === "image_gen") {
			if (attemptedImageCall) return { block: true, reason: "This E2E test allows one image request per phase." };
			attemptedImageCall = true;
		}
		log({ kind: "call", name: event.toolName, args: event.input });
	});
	pi.on("tool_result", (event) => {
		if (event.toolName !== "image_gen") return;
		log({
			kind: "result",
			isError: event.isError,
			mimeTypes: event.content.flatMap((block) => block.type === "image" ? [block.mimeType] : []),
			text: event.content.flatMap((block) => block.type === "text" ? [block.text] : []),
			details: event.details,
		});
	});
}
