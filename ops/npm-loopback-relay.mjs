import { spawn, execFileSync } from "node:child_process";
import { connect, createServer } from "node:net";

const listenHost = process.env.RELAY_ROLE === "container" ? "127.0.0.1" : "172.17.0.1";
const targetHost = process.env.RELAY_ROLE === "container" ? "172.17.0.1" : "127.0.0.1";
const port = 5173;

function bridge() {
  const server = createServer((socket) => {
    const upstream = connect({ host: targetHost, port });
    const close = () => {
      socket.destroy();
      upstream.destroy();
    };
    socket.on("error", close);
    upstream.on("error", close);
    upstream.on("connect", () => {
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
  });
  server.on("error", (err) => {
    console.error(`relay listen ${listenHost}:${port} failed: ${err.message}`);
    process.exit(1);
  });
  server.listen(port, listenHost, () => {
    console.log(`relay ${listenHost}:${port} -> ${targetHost}:${port}`);
    if (process.env.RELAY_ROLE !== "container") supervise();
  });
}

function supervise() {
  let pid = "";
  try {
    pid = execFileSync("docker", ["inspect", "-f", "{{.State.Pid}}", "n8n_proxy-manager_1"], {
      encoding: "utf8",
    }).trim();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    setTimeout(supervise, 2000);
    return;
  }
  if (!pid || pid === "0") {
    setTimeout(supervise, 2000);
    return;
  }
  const child = spawn("nsenter", ["-t", pid, "-n", "/usr/bin/node", process.argv[1]], {
    env: { ...process.env, RELAY_ROLE: "container", PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" },
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    console.error(`container relay exited ${code}`);
    setTimeout(supervise, 1000);
  });
}

bridge();
