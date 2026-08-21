import { spawn, exec } from "node:child_process";
import http from "node:http";
import path from "node:path";

const PORT = 3000;
const URL = `http://localhost:${PORT}`;
const isWin = process.platform === "win32";

// 启动 next dev：直接用 node 起，显式传堆上限（避免 next.cmd 包装层吞掉 NODE_OPTIONS）
// worker 进程的内存由 Next.js 根据 NODE_OPTIONS 自动分配
const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const dev = spawn(process.execPath, ["--max-old-space-size=12288", "--inspect", nextBin, "dev", "-p", String(PORT)], {
  stdio: "inherit",
  env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=12288" },
});

dev.on("error", (err) => {
  console.error("启动 next dev 失败:", err);
  process.exit(1);
});

dev.on("exit", (code) => {
  process.exit(code ?? 0);
});

function openBrowser() {
  const cmd = isWin
    ? `start "" ${URL}`
    : process.platform === "darwin"
      ? `open ${URL}`
      : `xdg-open ${URL}`;
  exec(cmd, (err) => {
    if (err) console.error("打开浏览器失败:", err);
  });
}

let opened = false;
function checkReady() {
  const req = http.get(URL, (res) => {
    res.resume();
    if (!opened) {
      opened = true;
      openBrowser();
    }
  });
  req.on("error", () => {
    if (!opened) setTimeout(checkReady, 500);
  });
  req.setTimeout(1500, () => {
    req.destroy();
    if (!opened) setTimeout(checkReady, 500);
  });
}

// 稍等服务器开始监听后再探测
setTimeout(checkReady, 1500);
