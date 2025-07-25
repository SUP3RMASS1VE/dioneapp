import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import semver from "semver";
import type { Server } from "socket.io";
import logger from "../utils/logger";
import acceptedDependencies from "./acceptedDependencies.json";
import { executeCommand } from "./process";

export interface Command {
	name: string;
	commands: string[];
	catch?: number;
	env?: {
		name?: string;
		type?: string;
		version?: string;
	};
	"not-required"?: boolean;
}

export interface DioneConfig {
	dependencies?: {
		[key: string]: {
			version: string;
		};
	};
	installation: Command[];
	start: Command[];
	requirements?: {
		gpus?: string[];
		os?: string[];
	};
}
export interface DependencyConfig {
	[key: string]: {
		checkCommand: string;
		versionRegex?: string;
		parseVersion?: (output: string) => string;
		installCommand?: {
			windows?: string;
			macos?: string;
			linux?: string;
		};
		uninstallCommand?: {
			windows?: string;
			macos?: string;
			linux?: string;
		};
		shouldRestart?: boolean;
	};
}

export async function readDioneConfig(filePath: string): Promise<DioneConfig> {
	try {
		const data = await fs.promises.readFile(filePath, "utf8");
		return JSON.parse(data) as DioneConfig;
	} catch (error) {
		logger.error("Error reading dione config file:", error);
		throw error;
	}
}

type versionResult = {
	isValid: boolean;
	reason?: string;
};

function isDependencyInstalled(
	dependency: string,
	requiredVersion: string,
	dependencyConfig: DependencyConfig,
): versionResult {
	if (!dependencyConfig[dependency]) {
		logger.warn(`Not found dependency ${dependency} in config file`);
		return { isValid: false, reason: "not-accepted" };
	}

	const config = dependencyConfig[dependency];
	const [cmd, ...args] = config.checkCommand.split(" ");

	const result = spawnSync(cmd, args);

	if (result.error && (result.error as any).code === "ENOENT") {
		logger.warn(`Dependency "${dependency}" is not installed.`);
		return { isValid: false, reason: "not-installed" };
	}

	if (result.status !== 0) {
		logger.error(
			`Error checking dependency ${dependency}:`,
			result.stderr?.toString(),
		);
		return { isValid: false, reason: "error" };
	}

	const installedVersion = result.stdout?.toString().trim() || "";

	if (requiredVersion === "latest") {
		return { isValid: true, reason: "required-version" };
	}

	if (!semver.satisfies(installedVersion, requiredVersion)) {
		logger.error(`Dependency "${dependency}" version is not satisfied`);
		return { isValid: false, reason: "version-not-satisfied" };
	}

	return { isValid: true, reason: "required-version" };
}

export function isDepForCurrentOS(dep: any): boolean {
	const depOS = dep.platform;
	const currentOS = os.platform();
	if (!depOS) return true;
	if (depOS === "windows" && currentOS === "win32") return true;
	if (depOS === "macos" && currentOS === "darwin") return true;
	if (depOS === "linux" && currentOS === "linux") return true;
	return false;
}

export async function checkDependencies(dioneFile: string): Promise<{
	success: boolean;
	missing: { name: string; installed: boolean; reason: string }[];
	error?: boolean;
}> {
	try {
		let config: DioneConfig;
		try {
			config = await readDioneConfig(dioneFile);
		} catch (error) {
			logger.error("Error reading dione config file:", error);
			return { success: false, missing: [], error: true };
		}
		const needEnv = JSON.stringify(config).includes("env");
		const envType =
			config.installation.find((dep) => dep.env)?.env?.type || "uv";
		const missing: {
			name: string;
			installed: boolean;
			reason: string;
			version: string;
		}[] = [];

		if (!config.dependencies) config.dependencies = {};

		// if use an env, add uv as dependency
		if (needEnv && envType === "uv" && !config.dependencies?.uv) {
			config.dependencies = {
				...config.dependencies,
				uv: {
					version: "latest",
				},
			};
		}
		// if use an env type conda, add conda as dependency
		if (needEnv && envType === "conda" && !config.dependencies?.conda) {
			config.dependencies = {
				...config.dependencies,
				conda: {
					version: "latest",
				},
			};
		}

		// if no dependencies, return success
		if (!config.dependencies) {
			logger.warn("No dependencies found in dione.json");
			return { success: true, missing: [] };
		}

		for (const [dependency, details] of Object.entries(
			config.dependencies || {},
		)) {
			// skip dep if not for current os
			if (!isDepForCurrentOS(details)) {
				continue;
			}

			const isInstalled = await isDependencyInstalled(
				dependency,
				details.version,
				acceptedDependencies,
			);

			if (!isInstalled.isValid) {
				logger.error(`Dependency "${dependency}" is not installed`);
				missing.push({
					name: dependency,
					installed: isInstalled.isValid,
					reason: isInstalled.reason as string,
					version: details.version,
				});
			} else {
				missing.push({
					name: dependency,
					installed: isInstalled.isValid,
					reason: "installed",
					version: details.version,
				});
			}
		}
		if (missing.length === 0) {
			logger.info("All dependencies are installed");
		}
		return {
			success: missing.every((dep) => dep.installed),
			missing,
		};
	} catch (error) {
		logger.error("Error checking dependencies:", error);
		return {
			success: false,
			missing: [],
		};
	}
}

function getPlatformKey() {
	const platform = os.platform();
	if (platform === "win32") return "windows";
	if (platform === "darwin") return "macos";
	return "linux";
}

export async function inUseDependencies(dioneFile: string) {
	const config = await readDioneConfig(dioneFile);
	const needEnv = JSON.stringify(config).includes("env");
	const envType = config.installation.find((dep) => dep.env)?.env?.type || "uv";
	if (envType === "uv" && !config.dependencies?.uv && needEnv) {
		config.dependencies = {
			...config.dependencies,
			uv: {
				version: "latest",
			},
		};
	}

	if (envType === "conda" && !config.dependencies?.conda && needEnv) {
		config.dependencies = {
			...config.dependencies,
			conda: {
				version: "latest",
			},
		};
	}
	return config.dependencies;
}

export async function uninstallDependency(
	selectedDeps: string[],
	dioneFile: string,
	io: Server,
) {
	const config = await readDioneConfig(dioneFile);
	const workingDir = path.dirname(dioneFile);
	const needEnv = JSON.stringify(config).includes("env");
	const envType = config.installation.find((dep) => dep.env)?.env?.type || "uv";
	if (!config.dependencies && !needEnv) {
		logger.warn("No dependencies found in dione.json");
		return {
			success: false,
			missing: [],
			error: true,
			reasons: ["no-dependencies"],
		};
	}

	if (!config.dependencies?.[envType] && needEnv) {
		config.dependencies = {
			envType: {
				version: "latest",
			},
		};
	}

	const results = [] as Array<{
		success: boolean;
		missing: string[];
		error: boolean;
		reason?: string;
	}>;
	for (const dependency of selectedDeps) {
		let reason: string | undefined;
		const depConfig = acceptedDependencies[dependency];
		const isInstalled = await isDependencyInstalled(
			dependency,
			config.dependencies?.[dependency]?.version || "latest",
			acceptedDependencies,
		);

		if (!isInstalled.isValid) {
			logger.error(`Dependency "${dependency}" is not installed`);
			results.push({
				success: false,
				missing: [],
				error: true,
				reason: "not-installed",
			});
			continue;
		}

		let uninstallCommand = depConfig.uninstallCommand;
		if (!uninstallCommand) {
			logger.error(`No uninstall command found for ${dependency}`);
			results.push({
				success: false,
				missing: [],
				error: true,
				reason: "no-uninstall-command",
			});
			continue;
		}

		if (
			typeof uninstallCommand === "object" &&
			!Array.isArray(uninstallCommand)
		) {
			const platformKey = getPlatformKey();
			uninstallCommand = uninstallCommand[platformKey];
		}

		if (!uninstallCommand) {
			logger.error(`No uninstall command found for platform for ${dependency}`);
			results.push({
				success: false,
				missing: [],
				error: true,
				reason: "no-uninstall-command-platform",
			});
			continue;
		}

		const uninstallCommands = Array.isArray(uninstallCommand)
			? uninstallCommand
			: [uninstallCommand.toString()];

		let success = true;
		for (const cmd of uninstallCommands) {
			const command = cmd.replace(/\s+/g, " ");
			logger.info(`Executing uninstall command: ${command}`);
			const result = await executeCommand(
				command,
				io,
				workingDir,
				"deleteUpdate",
			);
			if (result.stderr) {
				logger.error(
					`Error executing uninstall command for ${dependency}: ${result.stderr}`,
				);
				success = false;
				break;
			}
			logger.info(`Successfully uninstalled ${dependency}.`);
		}

		results.push({ success, missing: [], error: !success, reason });
	}

	return {
		success: results.every((r) => r.success),
		missing: [],
		error: results.some((r) => r.error),
		reasons: results.filter((r) => r.error).map((r) => r.reason),
	};
}
