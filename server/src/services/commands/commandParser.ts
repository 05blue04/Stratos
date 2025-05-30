import { validate as validateUUID } from "uuid";
import type { ParsedCommand } from "../../types/index.js";
import {
	BUILTIN_COMMANDS,
	getBuiltinCommands,
	getBuiltinCommandDetails,
} from "./builtinCommands.js";
import {
	AI_COMMANDS,
	getAICommandDetails,
	getAICommands,
} from "./aiCommands.js";

/**
 * Parse a command string to determine if it's a builtin, ai, or raw command
 */
export function parseCommand(commandStr: string): ParsedCommand {
	// Trim the command string
	const cmd = commandStr.trim();

	// Check if it's an AI command
	if (cmd.startsWith("/ai-")) {
		return parseAICommand(cmd);
	}

	// Check if it's a built-in command
	if (cmd.startsWith("/")) {
		return parseBuiltinCommand(cmd);
	}

	if (cmd.startsWith("ffmpeg ")) {
		return {
			type: "ffmpeg",
			command: cmd,
		};
	}
	if (cmd.startsWith("ffprobe ")) {
		return {
			type: "ffprobe",
			command: cmd,
		};
	}

	return {
		type: "ffmpeg",
		command: cmd,
	};
}

/**
 * Parse a built-in command with format: /command-name fileId [--option=value]
 */
function parseBuiltinCommand(commandStr: string): ParsedCommand {
	// Remove the leading slash
	const withoutSlash = commandStr.substring(1);

	// Split by spaces (but respect quoted strings)
	const parts = withoutSlash.match(/(?:[^\s"]+|"[^"]*")+/g) || [];

	if (parts.length < 2) {
		return {
			type: "builtin",
			command: parts[0] || "", // Ensure command is always a string
			error:
				"Built-in command requires at least a command name and input file ID",
		};
	}

	const commandName = parts[0];
	const input = parts[1];

	// Check if command exists
	if (!commandName || !BUILTIN_COMMANDS[commandName]) {
		return {
			type: "builtin",
			command: commandName || "", // Ensure command is always a string
			input,
			error: `Unknown built-in command: ${commandName || "empty"}`,
		};
	}

	const commandDef = BUILTIN_COMMANDS[commandName];

	// Check if input is a valid UUID
	if (!validateUUID(input)) {
		return {
			type: "builtin",
			command: commandName,
			input,
			error: "Input must be a valid file ID (UUID format)",
		};
	}

	// Parse options (format: --name=value)
	const options: Record<string, string | number | boolean> = {};
	let outputName: string | undefined;

	for (let i = 2; i < parts.length; i++) {
		const part = parts[i];

		// Output name specification
		if (part.startsWith("--output=")) {
			outputName = part.substring("--output=".length);
			// Remove quotes if present
			if (outputName.startsWith('"') && outputName.endsWith('"')) {
				outputName = outputName.substring(1, outputName.length - 1);
			}
			continue;
		}

		// Regular option
		if (part.startsWith("--")) {
			const equalsIndex = part.indexOf("=");
			if (equalsIndex > 0) {
				const name = part.substring(2, equalsIndex);
				let value: string | number | boolean = part.substring(equalsIndex + 1);

				// Remove quotes if present
				if (
					typeof value === "string" &&
					value.startsWith('"') &&
					value.endsWith('"')
				) {
					value = value.substring(1, value.length - 1);
				}

				// Convert to number if it looks like one
				if (/^-?\d+(\.\d+)?$/.test(value as string)) {
					value = Number.parseFloat(value as string);
				}

				// Convert to boolean if it's true/false
				if (value === "true") value = true;
				if (value === "false") value = false;

				options[name] = value;
			}
		}
	}

	// Transform to actual FFmpeg command
	const ffmpegCommand = commandDef.transform(input, options);

	return {
		type: "builtin",
		command: commandName,
		input,
		options,
		outputName,
		// Store the transformed command for execution
		transformedCommand: ffmpegCommand,
	};
}

/**
 * Parse an AI command with format: /ai-command-name fileId [--option=value]
 */
function parseAICommand(commandStr: string): ParsedCommand {
	// Remove the leading "/ai-"
	const withoutPrefix = commandStr.substring(4);

	// Split by spaces
	const parts = withoutPrefix.match(/(?:[^\s"]+|"[^"]*")+/g) || [];

	if (parts.length < 2) {
		return {
			type: "ai",
			command: parts[0] || "",
			error: "AI command requires at least a command name and input file ID",
		};
	}

	const commandName = parts[0];
	const input = parts[1];

	// Check if command exists
	if (!commandName || !AI_COMMANDS[commandName]) {
		return {
			type: "ai",
			command: commandName || "",
			input,
			error: `Unknown AI command: ${commandName || "empty"}`,
		};
	}

	// Check if input is a valid UUID
	if (!validateUUID(input)) {
		return {
			type: "ai",
			command: commandName,
			input,
			error: "Input must be a valid file ID (UUID format)",
		};
	}

	// Parse options (format: --name=value)
	const options: Record<string, string | number | boolean> = {};
	let outputName: string | undefined;

	for (let i = 2; i < parts.length; i++) {
		const part = parts[i];

		// Output name specification
		if (part.startsWith("--output=")) {
			outputName = part.substring("--output=".length);
			// Remove quotes if present
			if (outputName.startsWith('"') && outputName.endsWith('"')) {
				outputName = outputName.substring(1, outputName.length - 1);
			}
			continue;
		}

		// Regular option
		if (part.startsWith("--")) {
			const equalsIndex = part.indexOf("=");
			if (equalsIndex > 0) {
				const name = part.substring(2, equalsIndex);
				let value: string | number | boolean = part.substring(equalsIndex + 1);

				// Remove quotes if present
				if (
					typeof value === "string" &&
					value.startsWith('"') &&
					value.endsWith('"')
				) {
					value = value.substring(1, value.length - 1);
				}

				// Convert to number if it looks like one
				if (/^-?\d+(\.\d+)?$/.test(value as string)) {
					value = Number.parseFloat(value as string);
				}

				// Convert to boolean if it's true/false
				if (value === "true") value = true;
				if (value === "false") value = false;

				options[name] = value;
			}
		}
	}

	return {
		type: "ai",
		command: commandName,
		input,
		options,
		outputName,
	};
}

export { getBuiltinCommands, getBuiltinCommandDetails };
export { getAICommands, getAICommandDetails };
