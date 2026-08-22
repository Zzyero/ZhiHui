import { spawn, exec } from "node:child_process";
import http from "node:http";
import net from "node:net";
import path from "node:path";

const DEFAULT_PORT = 3000;
const isWin = process.platform === "win32";

// 检测端口是否被占用
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port);
  });
}

// 从 startPort 开始向后找第一个空闲端口
async function findFreePort(startPort) {
  let port = startPort;
  while (!(await isPortFree(port))) {
    port += 1;
  }
  return port;
}

const PORT = await findFreePort(DEFAULT_PORT);
const URL = `http://localhost:${PORT}`;

if (PORT !== DEFAULT_PORT) {
  console.log(`[dev] 端口 ${DEFAULT_PORT} 已被占用，改用端口 ${PORT}`);
}

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
