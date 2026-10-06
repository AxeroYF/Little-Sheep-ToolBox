import { createApp } from "../server/app";
// Explicit smoke check: opens the configured real client once, with no persistent account.
const app = await createApp({
  root: process.cwd(),
  databasePath: ":memory:",
  origin: "http://127.0.0.1:4328",
});
const headers = { host: "127.0.0.1:4328", origin: "http://127.0.0.1:4328" };
try {
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers,
    payload: {
      username: "小羊",
      password: "Workbox-Local-Dev-2026!",
    },
  });
  if (login.statusCode !== 200) throw new Error("Smoke account setup failed");
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  const launch = await app.inject({
    method: "POST",
    url: "/api/apps/yellow-dogs/launch",
    headers: { ...headers, cookie },
    payload: {},
  });
  console.log(
    JSON.stringify({ httpStatus: launch.statusCode, result: launch.json() }),
  );
  if (launch.statusCode !== 200) process.exitCode = 1;
} finally {
  await app.close();
}
