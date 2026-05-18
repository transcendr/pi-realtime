import { spawn } from "node:child_process";

const CHROME_APP_NAME = "Google Chrome";

export function openHelperUrl(url: string): void {
	openUrlWithPreferredBrowser(url, CHROME_APP_NAME);
}

export function openUrlWithPreferredBrowser(url: string, appName: string): void {
	const preferred = spawn("open", ["-a", appName, url], { detached: true, stdio: "ignore" });
	preferred.once("error", () => openUrlWithDefaultBrowser(url));
	preferred.once("exit", (code) => {
		if (code !== 0) openUrlWithDefaultBrowser(url);
	});
	preferred.unref();
}

function openUrlWithDefaultBrowser(url: string): void {
	const child = spawn("open", [url], { detached: true, stdio: "ignore" });
	child.unref();
}
