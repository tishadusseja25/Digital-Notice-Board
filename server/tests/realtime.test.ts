import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import { io as connectClient, type Socket } from "socket.io-client";
import type { Server } from "socket.io";
import { createApp } from "../src/app.js";
import { attachSocket } from "../src/realtime/socket.js";
import {
  PASSWORD,
  clearTestDb,
  connectTestDb,
  cookieValue,
  createUser,
  disconnectTestDb,
  makeAgent,
  testEnv,
} from "./helpers.js";

let http: HttpServer;
let io: Server;
let url: string;
const open: Socket[] = [];

/** A client that sends the given login cookie and Origin, like a browser would. */
function client(opts: { cookie?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.Cookie = `nb_access=${opts.cookie}`;
  if (opts.origin !== null) headers.Origin = opts.origin ?? testEnv.APP_ORIGIN;
  const s = connectClient(url, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    extraHeaders: headers,
  });
  open.push(s);
  return s;
}
const connected = (s: Socket) =>
  new Promise<Socket>((resolve, reject) => {
    s.once("connect", () => resolve(s));
    s.once("connect_error", reject);
  });

async function loginCookie(email: string, role: "committee" | "admin" = "committee") {
  await createUser(email, role);
  const res = await makeAgent().post("/api/auth/login").send({ email, password: PASSWORD });
  return cookieValue(res, "nb_access")!;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const roomSize = async (room: string) => (await io.in(room).fetchSockets()).length;

beforeAll(async () => {
  await connectTestDb();
  http = createServer(createApp(testEnv));
  io = attachSocket(http, testEnv, 1000);
  await new Promise<void>((r) => http.listen(0, r));
  url = `http://localhost:${(http.address() as AddressInfo).port}`;
});
afterEach(async () => {
  open.splice(0).forEach((s) => s.close());
  await clearTestDb();
});
afterAll(async () => {
  await io.close();
  await disconnectTestDb();
});

describe("socket rooms and access", () => {
  it("puts an anonymous visitor in the public room only", async () => {
    await connected(client());
    expect(await roomSize("public")).toBe(1);
    expect(await roomSize("admin")).toBe(0);
  });

  it("puts a committee member in public and their own room, not admin", async () => {
    const cookie = await loginCookie("ann@example.com");
    await connected(client({ cookie }));
    const [socket] = await io.in("public").fetchSockets();
    expect([...socket!.rooms].filter((r) => r.startsWith("user:"))).toHaveLength(1);
    expect(await roomSize("admin")).toBe(0);
  });

  it("puts an admin in the admin room", async () => {
    const cookie = await loginCookie("root@example.com", "admin");
    await connected(client({ cookie }));
    expect(await roomSize("admin")).toBe(1);
  });

  it("treats a forged or expired token as anonymous, not as an error", async () => {
    const forged = jwt.sign({ role: "admin" }, "wrong-secret", { subject: "x", expiresIn: 60 });
    await connected(client({ cookie: forged }));
    const expired = jwt.sign({ role: "admin" }, testEnv.JWT_ACCESS_SECRET, {
      subject: "x",
      expiresIn: -10,
    });
    await connected(client({ cookie: expired }));
    expect(await roomSize("public")).toBe(2);
    expect(await roomSize("admin")).toBe(0);
  });

  it("refuses a page from another origin but allows the app origin and no origin", async () => {
    await expect(connected(client({ origin: "https://evil.example" }))).rejects.toBeDefined();
    await connected(client({ origin: testEnv.APP_ORIGIN }));
    await connected(client({ origin: null }));
    expect(await roomSize("public")).toBe(2);
  });

  it("disconnects a socket when its login token expires", async () => {
    const id = (await createUser("short@example.com")).id as string;
    const cookie = jwt.sign({ role: "committee" }, testEnv.JWT_ACCESS_SECRET, {
      subject: id,
      expiresIn: 1,
    });
    const s = await connected(client({ cookie }));
    const closed = new Promise<string>((r) => s.once("disconnect", r));
    expect(await closed).toBe("io server disconnect");
  });

  it("ignores anything a client sends", async () => {
    const a = await connected(client());
    const b = await connected(client());
    const heard: string[] = [];
    b.onAny((event) => heard.push(event));
    a.emit("notice:created", { id: "fake" });
    a.emit("join", "admin");
    await sleep(150);
    expect(heard).toEqual([]);
    expect(await roomSize("admin")).toBe(0);
  });
});
