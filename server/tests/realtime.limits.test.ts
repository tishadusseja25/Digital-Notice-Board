import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as connectClient } from "socket.io-client";
import { attachSocket } from "../src/realtime/socket.js";
import { testEnv } from "./helpers.js";

it("refuses socket connections beyond the per-minute limit", async () => {
  const http = createServer();
  const io = attachSocket(http, testEnv, 2);
  await new Promise<void>((r) => http.listen(0, r));
  const url = `http://localhost:${(http.address() as AddressInfo).port}`;
  const sockets = [1, 2, 3].map(() =>
    connectClient(url, { transports: ["websocket"], forceNew: true, reconnection: false }),
  );
  const results = await Promise.all(
    sockets.map(
      (s) =>
        new Promise<string>((r) => {
          s.once("connect", () => r("ok"));
          s.once("connect_error", () => r("refused"));
        }),
    ),
  );
  expect(results.filter((r) => r === "ok")).toHaveLength(2);
  expect(results.filter((r) => r === "refused")).toHaveLength(1);
  sockets.forEach((s) => s.close());
  await io.close();
});
