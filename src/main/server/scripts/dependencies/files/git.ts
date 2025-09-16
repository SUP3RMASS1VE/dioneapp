import { execFile, spawn } from "child_process";
import fs from "fs";
import https from "https";
import path from "path";
import type { Server } from "socket.io";
import logger from "../../../utils/logger";
import { closeFile } from "../../delete";
import { addValue, getAllValues, removeValue } from "../environment";
import { getArch, getOS } from "../utils/system";

const depName = "git";
const ENVIRONMENT = getAllValues();

export async function isInstalled(
	binFolder: string,
): Promise<{ installed: boolean; reason: string }> {
	const depFolder = path.join(binFolder, depName);
	const ENVIRONMENT = getAllValues();

	if (process.platform === "linux" || process.platform === "darwin") {
		return { installed: true, reason: `installed` };
	}

	if (!fs.existsSync(depFolder) || fs.readdirSync(depFolder).length === 0) {
		return { installed: false, reason: `not-installed` };
	}

	try {
		await new Promise<string>((resolve, reject) => {
			execFile(
				depName,
				["--version"],
				{ env: ENVIRONMENT },
				(error, stdout) => {
					if (error) {
						reject(error);
					} else {
						resolve(stdout);
					}
				},
			);
		});
		return { installed: true, reason: `installed` };
	} catch (error: any) {
		return { installed: false, reason: `error` };
	}
}

export async function install(
	binFolder: string,
	id: string,
	io: Server,
): Promise<{ success: boolean }> {
	const depFolder = path.join(binFolder, depName);
	const tempDir = path.join(binFolder, "temp");

	const platform = getOS(); // window, linux, macos
	const arch = getArch(); // amd64, arm64, x86

	if (!fs.existsSync(depFolder)) {
		fs.mkdirSync(depFolder, { recursive: true });
	}

	const urls: Record<string, Record<string, string>> = {
		linux: {
			amd64: "https://github.com/git/git/archive/v2.50.1.tar.gz",
			arm64: "https://github.com/git/git/archive/v2.50.1.tar.gz",
		},
		macos: {
			amd64: "https://github.com/git/git/archive/v2.50.1.tar.gz",
			arm64: "https://github.com/git/git/archive/v2.50.1.tar.gz",
		},
		windows: {
			amd64:
				"https://github.com/git-for-windows/git/releases/download/v2.50.1.windows.1/MinGit-2.50.1-64-bit.zip",
			arm64:
				"https://github.com/git-for-windows/git/releases/download/v2.50.1.windows.1/MinGit-2.50.1-arm64.zip",
			x86: "https://github.com/git-for-windows/git/releases/download/v2.50.1.windows.1/MinGit-2.50.1-32-bit.zip",
		},
	};

	const url = urls[platform]?.[arch];
	if (!fs.existsSync(tempDir)) {
		// if temp dir does not exist, create it
		fs.mkdirSync(tempDir, { recursive: true });
	}
	const installerFile = fs.createWriteStream(
		path.join(tempDir, `git-${platform}-${arch}.zip`),
	);

	if (url) {
		// 1. url method: install the dependency using official installer url
		io.to(id).emit("installDep", {
			type: "log",
			content: `Downloading ${depName} for ${platform} (${arch}) using URL method...`,
		});
		await new Promise<void>((resolve, reject) => {
			https
				.get(url, (response) => {
					if ([301, 302].includes(response.statusCode ?? 0)) {
						const redirectUrl = response.headers.location;
						if (redirectUrl) {
							https
								.get(redirectUrl, (redirectResponse) => {
									redirectResponse.pipe(installerFile);
									installerFile.on("close", resolve);
									installerFile.on("error", reject);
								})
								.on("error", reject);
						} else {
							reject(new Error("Redirect URL not found"));
						}
					} else if (response.statusCode === 200) {
						io.to(id).emit("installDep", {
							type: "log",
							content: `${depName} installer downloaded successfully`,
						});
						response.pipe(installerFile);
						installerFile.on("close", resolve);
						installerFile.on("error", reject);
					} else {
						reject(new Error(`HTTP ${response.statusCode}`));
					}
				})
				.on("error", reject);
		});
	} else {
		io.to(id).emit("installDep", {
			type: "error",
			content: `No download URL found for ${depName} on ${platform} (${arch})`,
		});
	}

	const commands: Record<string, { file: string; args: string[] }> = {
		linux: {
			file: "bash",
			args: [
				"-c",
				`
                cd "${tempDir}" && 
                tar -xzf git-${platform}-${arch}.tar.gz && 
                cd git-* && 
                make configure && 
                ./configure --prefix="${depFolder}" && 
                make all && 
                make install
            `,
			],
		},
		macos: {
			file: "bash",
			args: [
				"-c",
				`
                cd "${tempDir}" && 
                tar -xzf git-${platform}-${arch}.tar.gz && 
                cd git-* && 
                make configure && 
                ./configure --prefix="${depFolder}" && 
                make all && 
                make install
            `,
			],
		},
		windows: {
			file: `tar`,
			args: [
				"-xf",
				path.join(tempDir, `git-${platform}-${arch}.zip`),
				"-C",
				depFolder,
			],
		},
	};

	// 2. run the installer/ command line method
	const command = commands[platform];
	if (!command) {
		io.to(id).emit("installDep", {
			type: "error",
			content: `Unsupported platform: ${platform}`,
		});
		return { success: false };
	}

	io.to(id).emit("installDep", {
		type: "log",
		content: `Running command: ${command.file} ${command.args.join(" ")}`,
	});

	const spawnOptions = {
		cwd: depFolder,
		shell: platform === "windows",
		windowsHide: true,
		detached: false,
		env: {
			...ENVIRONMENT,
			PYTHONUNBUFFERED: "1",
			NODE_NO_BUFFERING: "1",
			FORCE_UNBUFFERED_OUTPUT: "1",
			PYTHONIOENCODING: "UTF-8",
		},
	};

	try {
		await new Promise<void>((resolve, reject) => {
			const child = spawn(command.file, command.args, spawnOptions);

			child.stdout.on("data", (data) => {
				io.to(id).emit("installDep", { type: "log", content: data.toString() });
			});

			child.stderr.on("data", (data) => {
				io.to(id).emit("installDep", {
					type: "error",
					content: data.toString(),
				});
			});

			child.on("close", (code) => {
				if (code === 0) {
					io.to(id).emit("installDep", {
						type: "log",
						content: `${depName} installed successfully`,
					});
					resolve();

					// update environment variables
					if (platform === "windows") {
						addValue("PATH", path.join(depFolder, "cmd"));
					} else {
						// linux/macos
						addValue("PATH", path.join(depFolder, "bin"));
						addValue(
							"GIT_EXEC_PATH",
							path.join(depFolder, "libexec", "git-core"),
						);
						addValue(
							"GIT_TEMPLATE_DIR",
							path.join(depFolder, "share", "git-core", "templates"),
						);
					}

					return { success: true };
				} else {
					reject(new Error(`Installer exited with code ${code}`));
					return { success: false };
				}
			});
		});
	} catch (error) {
		return { success: false };
	}

	return { success: true };
}

export async function uninstall(binFolder: string): Promise<void> {
	const depFolder = path.join(binFolder, depName);
	if (fs.existsSync(depFolder)) {
		logger.info(`Removing ${depName} folder in ${depFolder}...`);
		await closeFile(depFolder);
		fs.rmSync(depFolder, { recursive: true, force: true });
		logger.info(`Removing ${depName} from environment variables...`);
		if (getOS() === "windows") {
			removeValue(path.join(depFolder, "cmd"), "PATH");
		} else {
			removeValue(path.join(depFolder, "bin"), "PATH");
			removeValue(path.join(depFolder, "libexec", "git-core"), "GIT_EXEC_PATH");
			removeValue(
				path.join(depFolder, "share", "git-core", "templates"),
				"GIT_TEMPLATE_DIR",
			);
		}

		logger.info(`${depName} uninstalled successfully`);
	} else {
		throw new Error(`Dependency ${depName} is not installed`);
	}
}
