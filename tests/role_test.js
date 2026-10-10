// Throwaway role test: starts the server on another port with random test passcodes and checks each role.
const { spawn } = require("child_process");
const crypto = require("crypto");
const path = require("path");

const root = process.argv[2];
const UP = crypto.randomBytes(8).toString("hex"), AD = crypto.randomBytes(8).toString("hex");
// Its own port and its own empty store file, so it never touches the real upload history and two runs cannot collide.
const PORT = String(5200 + crypto.randomInt(700)), STORE_PATH = path.join(require("os").tmpdir(), `flusentinel-test-store-${crypto.randomBytes(4).toString("hex")}.json`);
const srv = spawn("node", [path.join(root, "server.js")], { env: { ...process.env, PORT, STORE_PATH, UPLOAD_PASSCODE: UP, ADMIN_PASSCODE: AD }, stdio: "ignore" });
const B = `http://localhost:${PORT}/api`;
const call = async (method, url, pass, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json", ...(pass ? { "x-passcode": pass } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch {}
  return { s: r.status, d };
};
const row = { type: "ili", rows: [{ year: 2026, week: 38, rate: 6.5 }], by: "tester" };
const results = [];
const check = (name, got, want) => results.push(`${got === want ? "PASS" : "FAIL"}  ${name}: got ${got}, expected ${want}`);

(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch(B + "/state?mode=live"); break; } catch { await new Promise((r) => setTimeout(r, 150)); } }
  let r = await call("GET", "/state?mode=live");
  check("viewer can read", r.s, 200); check("viewer role", r.d.auth.role, "viewer"); check("passcode required", r.d.auth.required, true);
  check("viewer cannot upload", (await call("POST", "/state?mode=live", null, row)).s, 401);
  check("wrong passcode cannot upload", (await call("POST", "/state?mode=live", "nope", row)).s, 401);
  r = await call("POST", "/state?mode=live", UP, row);
  check("uploader can upload", r.s, 200); check("upload is in use", r.d.ili.length, 1); check("history records who", r.d.log[0].by + "/" + r.d.log[0].role, "tester/uploader");
  check("history does not leak rows", "rows" in r.d.log[0], false);
  const id = r.d.log[0].id;
  check("uploader cannot reset everything", (await call("DELETE", "/state?mode=live", UP)).s, 401);
  r = await call("POST", "/undo?mode=live", UP, { id });
  check("uploader can undo", r.s, 200); check("undone upload no longer in use", r.d.ili.length, 0); check("undone upload stays in history", r.d.log.length, 1);
  check("uploader cannot restore", (await call("POST", "/undo?mode=live", UP, { id, restore: true })).s, 401);
  r = await call("POST", "/undo?mode=live", AD, { id, restore: true });
  check("admin can restore", r.s, 200); check("restored upload in use again", r.d.ili.length, 1);
  r = await call("DELETE", "/state?mode=live", AD);
  check("admin can reset everything", r.s, 200); check("reset empties current data", r.d.ili.length, 0); check("reset keeps the history", r.d.log.length, 1);
  check("replay mode is separate", (await call("GET", "/state?mode=replay")).d.log.length, 0);
  for (let i = 0; i < 10; i++) await call("POST", "/state?mode=live", "bad" + i, row);
  check("locked out after 10 wrong passcodes", (await call("POST", "/state?mode=live", UP, row)).s, 429);
  srv.kill(); try { require("fs").unlinkSync(STORE_PATH); } catch {}
  console.log(results.join("\n"));
  console.log(results.every((x) => x.startsWith("PASS")) ? "ALL PASSED" : "SOME FAILED");
})().catch((e) => { srv.kill(); console.error("test crashed", e); });
