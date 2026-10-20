const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

test("MCP requires an actual local start time and preserves seconds before writing", async () => {
  const bodies = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      bodies.push(JSON.parse(body));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { id: "start-time-test" } }));
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const transport = new StdioClientTransport({
    command: process.execPath, args: ["dist/index.js"],
    env: {
      ...process.env, TZ: "UTC", MCP_TRANSPORT: "stdio",
      SEVENPACE_AUTH_METHOD: "bearer", SEVENPACE_ORGANIZATION: "test",
      SEVENPACE_TOKEN: "test-local",
      SEVENPACE_BASE_URL: "http://127.0.0.1:" + server.address().port,
      SEVENPACE_API_PATH: "/api/rest",
    }, stderr: "pipe",
  });
  const client = new Client({ name: "start-time-regression", version: "1.0" }, { capabilities: {} });
  try {
    await client.connect(transport);
    const list = await client.listTools();
    assert(list.tools.find(tool => tool.name === "log_time").inputSchema.required.includes("startTime"));
    const args = { workItemId: 42, date: "2026-10-20", hours: 95 / 3600, description: "Test" };
    for (const startTime of [undefined, null, "", "09:17", "24:00:00", "12:60:00", "12:00:60", "09:17:42Z", "09:17:42.1234"]) {
      await assert.rejects(() => client.callTool({ name: "log_time", arguments: { ...args, startTime } }), /startTime is required/);
    }
    assert.equal(bodies.length, 0, "Invalid start times must not reach the API");
    for (const startTime of ["09:17:42", "14:12:34.567", "00:00:00", "23:59:59.999"]) {
      const result = await client.callTool({ name: "log_time", arguments: { ...args, startTime } });
      assert(!result.isError);
      assert.equal(bodies.at(-1).timeStamp, "2026-10-20T" + startTime);
      assert.equal(bodies.at(-1).length, 95);
      assert.equal(bodies.at(-1).billableLength, 95);
      assert(result.content.some(item => item.text?.includes(startTime)));
    }
  } finally {
    await client.close();
    server.closeAllConnections();
    server.close();
  }
});
