import { app, BrowserWindow, nativeTheme, safeStorage } from "electron";
import { join } from "node:path";
import { openDatabase, type DatabaseContext } from "./database/connection";
import { registerIpc } from "./ipc";
import { LectureMateService } from "./services/lectureMateService";
import { runPhase4Benchmark } from "./benchmarkPhase4";

let context: DatabaseContext | undefined;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 640, title: "LectureMate",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111315" : "#f7f7f5",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, "../../dist/index.html"));
}

app.whenReady().then(() => {
  try {
    context = openDatabase(app.getPath("appData"));
    const service = new LectureMateService(context.db, context.coursesRoot, context.dataRoot, {
      encrypt: (value) => { if (!safeStorage.isEncryptionAvailable()) throw new Error("系统安全存储暂不可用"); return safeStorage.encryptString(value).toString("base64"); },
      decrypt: (value) => safeStorage.decryptString(Buffer.from(value, "base64")),
    });
    if (process.env.LECTUREMATE_BENCHMARK === "1") { void runPhase4Benchmark(service).then(() => app.quit(), (error: unknown) => { console.error(`[AI benchmark] failed=${error instanceof Error ? error.message : "unknown"}`); app.exit(1); }); return; }
    registerIpc(service);
    createWindow();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  } catch (error) {
    console.error("LectureMate 初始化失败", error);
    app.quit();
  }
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => context?.db.close());
