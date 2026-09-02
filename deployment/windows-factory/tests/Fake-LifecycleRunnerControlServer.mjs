import http from "node:http";

const server = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    const payload = request.url === "/runner/active-jobs"
      ? { jobs: [] }
      : request.url === "/runner/poll-claim"
        ? { job: null }
        : {};
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });
});

server.listen(3002, "127.0.0.1", () => process.stdout.write("READY\n"));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
