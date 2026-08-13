import { spawn, exec } from "node:child_process";
import http from "node:http";

const PORT = 3000;
const URL = `http://localhost:${PORT}`;
const isWin = process.platform === "win32";

// 启动 next dev
const dev = spawn(isWin ? "next.cmd" : "next", ["dev", "-p", String(PORT)], {
  stdio: "inherit",
  shell: isWin,
  env: { ...process.env, NODE_OPTIONS: "--inspect" },
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
