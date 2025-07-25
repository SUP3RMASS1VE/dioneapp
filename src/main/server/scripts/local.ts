import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "socket.io";
import { readConfig } from "../../config";
import logger from "../utils/logger";
import { checkDependencies } from "./dependencies";
import executeInstallation from "./execute";
import { checkSystem } from "./system";

const root = process.cwd();
const config = readConfig();
const scriptsFolder = path.join(root, "scripts");
const appFolder = path.join(config?.defaultInstallFolder || root, "apps");

export async function getAllLocalScripts() {
	const scriptsPath = path.join(process.cwd(), "scripts");
	if (!fs.existsSync(scriptsPath)) {
		fs.mkdirSync(scriptsPath);
	}

	const scripts = fs.readdirSync(scriptsPath);
	const scriptsInfo: {
		id: string;
		name: string;
		description: string;
	}[] = [];
	for (const script of scripts) {
		const scriptPath = path.join(scriptsPath, script);
		const appInfoPath = path.join(scriptPath, "app_info.json");
		if (fs.existsSync(appInfoPath)) {
			const appInfo = JSON.parse(fs.readFileSync(appInfoPath, "utf-8"));
			scriptsInfo.push({
				id: appInfo.id,
				name: appInfo.name,
				description: appInfo.description,
			});
		}
	}
	return scriptsInfo || [];
}

// check script data on SCRIPTS folder
export async function getLocalScript(name: string) {
	const sanitizedName = name.replace(/\s+/g, "-");
	const scriptPath = path.join(scriptsFolder, sanitizedName);
	const scriptInfo = JSON.parse(
		fs.readFileSync(path.join(scriptPath, "app_info.json"), "utf-8"),
	);

	return scriptInfo;
}

export async function getLocalScriptById(id: string) {
	const scripts = fs.readdirSync(scriptsFolder);
	for (const script of scripts) {
		const scriptPath = path.join(scriptsFolder, script);
		const appInfoPath = path.join(scriptPath, "app_info.json");
		if (fs.existsSync(appInfoPath)) {
			const appInfo = JSON.parse(fs.readFileSync(appInfoPath, "utf-8"));
			if (appInfo.id === id) {
				return appInfo;
			}
		}
	}
}

// check if scripts are installed on APPS folder
export async function getInstalledLocalScript(name: string) {
	const sanitizedName = name.replace(/\s+/g, "-");
	const scriptPath = path.join(appFolder, sanitizedName);
	try {
		await fs.promises.readdir(scriptPath);
		return true;
	} catch (error) {
		return false;
	}
}

// install script on APPS folder
export async function loadLocalScript(name: string, io: Server) {
	// get script from scripts folder
	const scriptPath = path.join(scriptsFolder, name.replace(/\s+/g, "-"));
	const dioneFilePath = path.join(scriptPath, "dione.json");
	const appInfoPath = path.join(scriptPath, "app_info.json");

	// copy script to apps folder
	const appPath = path.join(appFolder, name.replace(/\s+/g, "-"));

	if (!fs.existsSync(appPath)) {
		fs.mkdirSync(appPath, { recursive: true });
	}

	fs.copyFileSync(dioneFilePath, path.join(appPath, "dione.json"));
	fs.copyFileSync(appInfoPath, path.join(appPath, "app_info.json"));

	const dioneConfigPath = path.join(appPath, "dione.json");
	const scriptInfo = JSON.parse(
		fs.readFileSync(path.join(appPath, "app_info.json"), "utf-8"),
	);
	const id = scriptInfo.id;
	// check system requirements
	const systemCheck = await checkSystem(dioneConfigPath);
	if (systemCheck.success === false) {
		io.to(id).emit("installUpdate", {
			type: "log",
			content: "System requirements not met.",
		});
		io.to(id).emit("installUpdate", {
			type: "status",
			status: "error",
			content: "Error detected",
		});
		io.to(id).emit("notSupported", {
			reasons: systemCheck.reasons,
		});
		return;
	} else {
		io.to(id).emit("installUpdate", {
			type: "log",
			content: "All system requirements are met.",
		});
	}
	// check deps
	const result = await checkDependencies(dioneConfigPath);
	if (result.success) {
		io.to(id).emit("installUpdate", {
			type: "log",
			content: "All required dependencies are installed.",
		});
		io.to(id).emit("installUpdate", {
			type: "status",
			status: "success",
			content: "Dependencies installed",
		});
		// checking dependencies finished, now executing installation
		await executeInstallation(dioneConfigPath, io, id).catch((error) => {
			console.error(`Unhandled error: ${error.message}`);
			process.exit(1);
		});
	} else if (result.error) {
		io.to(id).emit("installUpdate", {
			type: "log",
			content: `ERROR: ${result.error}`,
		});
		io.to(id).emit("installUpdate", {
			type: "status",
			status: "error",
			content: "Error detected",
		});
		logger.error(`Error downloading script: ${result.error}`);
	} else {
		io.to(id).emit("missingDeps", result.missing);
		io.to(id).emit("installUpdate", {
			type: "log",
			content: `ERROR: Some dependencies are missing: ${result.missing.map((dep) => dep.name).join(", ")}`,
		});
		io.to(id).emit("installUpdate", {
			type: "status",
			status: "error",
			content: "Error detected",
		});
		logger.warn(
			`Some dependencies are missing: ${result.missing.map((dep) => dep.name).join(", ")}`,
		);
	}
}

// upload script to SCRIPTS folder
export async function uploadLocalScript(
	filePath: string,
	name: string,
	description: string,
) {
	const appInfoContent = {
		name: name || "Script",
		description: description || "",
		id: randomUUID(),
	};
	const dioneConfigContent = JSON.parse(fs.readFileSync(filePath, "utf-8"));
	const sanitizedName = name.replace(/\s+/g, "-");
	const id = appInfoContent.id;

	logger.info(`Uploading script '${name}' with ID '${id}'`);

	const scriptsFolder = path.join(process.cwd(), "scripts");
	const scriptPath = path.join(scriptsFolder, sanitizedName);
	fs.mkdirSync(scriptPath, { recursive: true });
	fs.writeFileSync(
		path.join(scriptPath, "dione.json"),
		JSON.stringify(dioneConfigContent),
	);
	fs.writeFileSync(
		path.join(scriptPath, "app_info.json"),
		JSON.stringify(appInfoContent),
	);

	return appInfoContent;
}

// delete script from SCRIPTS folder
export async function deleteLocalScript(name: string) {
	const scriptsFolder = path.join(process.cwd(), "scripts");
	const sanitizedName = name.replace(/\s+/g, "-");
	const scriptPath = path.join(scriptsFolder, sanitizedName);
	fs.rmSync(scriptPath, { recursive: true });
}
