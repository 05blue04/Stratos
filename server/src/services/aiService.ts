import sql from "../config/database.js";
import log from "../config/logger.js";
import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { OUTPUT_CONFIG } from "../types/index.js";
import type { ParsedCommand } from "../types/index.js";
import axios from "axios";
import { eventService } from "./eventService.js";

const execAsync = promisify(exec);
const AI_URL = process.env.AI_URL || "http://stratos-ai:5001";

interface ProgressData {
	progress: number;
	message?: string;
}

export const aiService = {
	/**
	 * Process an AI task based on its type
	 */
	processAITask: async (
		taskId: string,
		commandResult: ParsedCommand,
	): Promise<void> => {
		try {
			// Update task status to processing
			await sql`UPDATE tasks SET status = 'processing' WHERE id = ${taskId}`;

			// Get file paths for all files associated with the task
			const taskFiles = await sql`
				SELECT f.id, f.file_path, f.file_name, f.mime_type
				FROM files f
				JOIN task_files tf ON f.id = tf.file_id
				WHERE tf.task_id = ${taskId}
			`;

			if (taskFiles.length === 0) {
				throw new Error("No files found for task");
			}

			// We'll use the first file as the input
			const inputFile = taskFiles[0];
			const inputFileInfo = {
				file_path: inputFile.file_path,
				file_name: inputFile.file_name,
				mime_type: inputFile.mime_type,
			};

			// Create task-specific output directory if it doesn't exist
			const outputDir = path.join(OUTPUT_CONFIG.DIR, taskId);
			await fs.mkdir(outputDir, { recursive: true });

			// Process according to AI command type
			let resultFilePath = "";

			if (commandResult.command === "transcribe") {
				resultFilePath = await processTranscription(
					taskId,
					commandResult,
					inputFileInfo,
					outputDir,
				);
			} else if (commandResult.command === "slowmotion") {
				resultFilePath = await processSlowmo(
					taskId,
					commandResult,
					inputFileInfo,
					outputDir,
				);
			} else if (commandResult.command === "fpsboost") {
				resultFilePath = await processFpsBoost(
					taskId,
					commandResult,
					inputFileInfo,
					outputDir,
				);
			} else if (commandResult.command === "subtitle") {
				resultFilePath = await processAiSubtitle(
					taskId,
					commandResult,
					inputFileInfo,
					outputDir,
				);
			} else {
				throw new Error(`Unsupported AI command: ${commandResult.command}`);
			}

			// Update task as completed
			await sql`
				UPDATE tasks 
				SET status = 'completed', 
					result_path = ${resultFilePath}, 
					updated_at = NOW() 
				WHERE id = ${taskId}
			`;

			// Emit completion event
			eventService.emitTaskComplete(taskId, {
				taskId,
				status: "completed",
				resultPath: resultFilePath,
			});

			log.info(`AI Task ${taskId} completed successfully`);
		} catch (error) {
			log.error(`Error executing AI task ${taskId}:`, error);

			// Update task as failed
			await sql`
				UPDATE tasks 
				SET status = 'failed', 
					error = ${String(error)}, 
					updated_at = NOW() 
				WHERE id = ${taskId}
			`;

			// Emit failure event
			eventService.emitTaskFailed(taskId, String(error));
		}
	},
};

/**
 * Process Transcription task
 */
async function processTranscription(
	taskId: string,
	commandResult: ParsedCommand,
	inputFile: { file_path: string; file_name: string; mime_type: string },
	outputDir: string,
): Promise<string> {
	const options = commandResult.options || {};
	const language = (options.language as string) || "auto";
	const format = (options.format as string) || "txt";

	log.info(
		`Preparing for transcription: ${inputFile.file_name} with language ${language}`,
	);

	// Generate output filename for extracted audio
	const baseName = path.parse(inputFile.file_name).name;
	const audioFile = `${baseName}-audio.wav`;
	const audioPath = path.join(outputDir, audioFile);

	// Extract audio using FFmpeg
	eventService.emitTaskProgress(taskId, {
		taskId,
		progress: 0.1,
		message: "Extracting audio from video...",
	});
	await extractAudio(inputFile.file_path, audioPath);
	log.info(`Successfully extracted audio to ${audioPath}`);

	// Define output file path for transcription result
	const transcriptionFile = `${baseName}-transcription.${format}`;
	const resultFilePath = path.join(outputDir, transcriptionFile);

	// optionsString : "language-auto-format-txt"
	// safeFilePath	: Replace '/' with '+' in the filePath for URL safety
	const optionsString = Object.entries({ language, format }).map(
		([key, value]) => `${key}-${value}`,
	);
	const safeFilePath = audioPath.replace(/\//g, "+");

	log.info(`Sending file to AI service: transcribe with ${audioPath}`);
	try {
		// Call the external AI service for transcription
		eventService.emitTaskProgress(taskId, {
			taskId,
			progress: 0.2,
			message: "Starting transcription...",
		});
		const response = await axios.post(
			`${AI_URL}/transcribe/${safeFilePath}/${optionsString}`,
		);

		eventService.emitTaskProgress(taskId, {
			taskId,
			progress: 0.9,
			message: "Saving transcription...",
		});

		log.info(`Transcription saved at ${resultFilePath}`);

		// Clean up: Delete the temporary audio file since we don't need it anymore
		try {
			await fs.unlink(audioPath);
			log.info(`Cleaned up temporary audio file: ${audioPath}`);
		} catch (cleanupError) {
			// Don't fail the whole operation if cleanup fails
			log.warn(`Failed to clean up audio file ${audioPath}: ${cleanupError}`);
		}
	} catch (error) {
		log.error(`Failed to get transcription from AI service: ${error}`);

		// Create a placeholder file in case of error
		await fs.writeFile(
			resultFilePath,
			`Error transcribing ${inputFile.file_name}: ${error}\n\nAudio file is available at ${audioPath}`,
			"utf8",
		);

		throw new Error(`Transcription service error: ${error}`);
	}
	return resultFilePath;
}

/**
 * Process Slowmo task
 */
async function processSlowmo(
	taskId: string,
	commandResult: ParsedCommand,
	inputFile: { file_path: string; file_name: string; mime_type: string },
	outputDir: string,
): Promise<string> {
	const options = commandResult.options || {};
	const speed = (options.speed as number) || 0.5;

	log.info(
		`Preparing for slow motion: ${inputFile.file_name} with speed factor ${speed}`,
	);

	// Generate temporary MP4 file
	const baseName = path.parse(inputFile.file_name).name;
	const tempFile = `${baseName}.mp4`;
	const tempPath = path.join(outputDir, tempFile);

	// Convert input to MP4 if needed
	try {
		eventService.emitTaskProgress(taskId, {
			taskId,
			progress: 0.1,
			message: "Preparing video for processing...",
		});
		log.info(`Converting input to MP4 format: ${tempPath}`);
		await execAsync(
			`ffmpeg -i "${inputFile.file_path}" -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 128k "${tempPath}"`,
		);
		log.info("Temporary MP4 file created successfully");
	} catch (error) {
		log.error(`Failed to create temporary MP4 file: ${error}`);
		throw new Error("Failed to prepare video for slow motion processing");
	}

	// Generate output filename
	const outputFile = `${baseName}-slowmo.mp4`;
	const resultFilePath = path.join(outputDir, outputFile);

	// Prepare options string for the AI service
	const optionsString = `speed=${speed}`;
	const safeFilePath = tempPath.replace(/\//g, "+");

	log.info(`Sending file to AI service: Slow Motion with ${tempPath}`);
	try {
		// Call the external AI service for slow motion
		eventService.emitTaskProgress(taskId, {
			taskId,
			progress: 0.2,
			message: "Starting slow motion processing...",
		});

		// Start the slow motion processing
		const response = await axios.post(
			`${AI_URL}/slowmo/${safeFilePath}/${optionsString}`,
		);

		eventService.emitTaskProgress(taskId, {
			taskId,
			progress: 0.9,
			message: "Saving processed video...",
		});

		log.info(`Slow motion video saved at ${resultFilePath}`);

		// Clean up temporary file
		try {
			await fs.unlink(tempPath);
			log.info(`Cleaned up temporary file: ${tempPath}`);
		} catch (cleanupError) {
			// Don't fail the whole operation if cleanup fails
			log.warn(
				`Failed to clean up temporary file ${tempPath}: ${cleanupError}`,
			);
		}

		return resultFilePath;
	} catch (error) {
		log.error(`Failed to get slow motion video from AI service: ${error}`);
		throw new Error(`Slow motion service error: ${error}`);
	}
}

/**
 * Process Frame Rate Boost task
 */
async function processFpsBoost(
	taskId: string,
	commandResult: ParsedCommand,
	inputFile: { file_path: string; file_name: string; mime_type: string },
	outputDir: string,
): Promise<string> {
	const options = commandResult.options || {};
	const factor = (options.speed as number) || 2;

	log.info(
		`Preparing for frame rate boost: ${inputFile.file_name} with frame rate factor ${factor}`,
	);

	// Generate temporary MP4 file
	const baseName = path.parse(inputFile.file_name).name;
	const tempFile = `${baseName}.mp4`;
	const tempPath = path.join(outputDir, tempFile);

	// Convert input to MP4 if needed
	try {
		eventService.emitTaskProgress(taskId, {
			taskId,
			progress: 0.1,
			message: "Preparing video for processing...",
		});
		log.info(`Converting input to MP4 format: ${tempPath}`);
		await execAsync(
			`ffmpeg -i "${inputFile.file_path}" -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 128k "${tempPath}"`,
		);
		log.info("Temporary MP4 file created successfully");
	} catch (error) {
		log.error(`Failed to create temporary MP4 file: ${error}`);
		throw new Error("Failed to prepare video for frame rate boost processing");
	}

	// Generate output filename
	const outputFile = `${baseName}-fpsboost.mp4`;
	const resultFilePath = path.join(outputDir, outputFile);

	// Prepare options string for the AI service
	const optionsString = `factor=${factor}`;
	const safeFilePath = tempPath.replace(/\//g, "+");

	log.info(`Sending file to AI service: Frame Rate Boost with ${tempPath}`);
	try {
		// Call the external AI service for frame rate boost
		eventService.emitTaskProgress(taskId, {
			taskId,
			progress: 0.2,
			message: "Starting frame rate boost...",
		});

		// Start the frame rate boost processing
		const response = await axios.post(
			`${AI_URL}/fpsboost/${safeFilePath}/${optionsString}`,
		);

		eventService.emitTaskProgress(taskId, {
			taskId,
			progress: 0.9,
			message: "Saving processed video...",
		});

		log.info(`Frame rate boosted video saved at ${resultFilePath}`);

		// Clean up temporary file
		try {
			await fs.unlink(tempPath);
			log.info(`Cleaned up temporary file: ${tempPath}`);
		} catch (cleanupError) {
			// Don't fail the whole operation if cleanup fails
			log.warn(
				`Failed to clean up temporary file ${tempPath}: ${cleanupError}`,
			);
		}

		return resultFilePath;
	} catch (error) {
		log.error(
			`Failed to get frame rate booster video from AI service: ${error}`,
		);
		throw new Error(`Frame Rate Boost service error: ${error}`);
	}
}

/**
 * Process AI Subtitle task
 */
async function processAiSubtitle(
	taskId: string,
	commandResult: ParsedCommand,
	inputFile: { file_path: string; file_name: string; mime_type: string },
	outputDir: string,
): Promise<string> {
	const options = commandResult.options || {};
	const language = (options.language as string) || "auto";
	const format = (options.format as string) || "mp4";

	log.info(
		`Preparing for AI subtitle: ${inputFile.file_name} with language ${language}`,
	);

	// First, generate the transcription
	const transcriptionResult = await processTranscription(
		taskId,
		{ ...commandResult, options: { ...options, format: "srt" } },
		inputFile,
		outputDir,
	);

	// Generate output filename
	const baseName = path.parse(inputFile.file_name).name;
	const outputFile = `${baseName}-subtitled.${format}`;
	const resultFilePath = path.join(outputDir, outputFile);

	// Apply subtitles to the video using FFmpeg
	try {
		eventService.emitTaskProgress(taskId, {
			taskId,
			progress: 0.8,
			message: "Applying subtitles to video...",
		});
		// Replace .srt with .ass
		const transcriptionResultAss = transcriptionResult.replace(
			/\.srt$/,
			".ass",
		);
		// create a new file with .en.srt
		await execAsync(
			`ffmpeg -i ${transcriptionResult} ${transcriptionResultAss}`,
		);
		await execAsync(
			`ffmpeg -i ${inputFile.file_path} -vf ass=${transcriptionResultAss} -c:v libx264 -crf 23 -preset fast -c:a copy ${resultFilePath}`,
		);
		// Log the resultFilePath
		log.info(`Subtitles applied to video: ${resultFilePath}`);
		// Clean up the temporary SRT file
		await fs.unlink(transcriptionResult);
		await fs.unlink(transcriptionResultAss);
		log.info("Temporary SRT file cleaned up successfully");
		log.info("Temporary ASS file cleaned up successfully");

		eventService.emitTaskProgress(taskId, {
			taskId,
			progress: 1.0,
			message: "Subtitles applied successfully",
		});

		return resultFilePath;
	} catch (error) {
		log.error(`Failed to apply subtitles: ${error}`);
		throw new Error("Failed to apply subtitles to video");
	}
}

/**
 * Extract audio from a video file using FFmpeg
 */
async function extractAudio(
	videoPath: string,
	outputPath: string,
): Promise<void> {
	const command = `ffmpeg -i "${videoPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${outputPath}"`;

	try {
		await execAsync(command);
	} catch (error) {
		log.error(`FFmpeg audio extraction failed: ${error}`);
		throw new Error("Failed to extract audio from video");
	}
}
