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
  createCategory,
  createUser,
  disconnectTestDb,
  noticeBody,
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

describe("live notice events", () => {
  /** Records every event a socket receives. */
  const listen = (s: Socket) => {
    const got: { event: string; data: Record<string, unknown> }[] = [];
    s.onAny((event, data) => got.push({ event, data }));
    return got;
  };
  const waitFor = async (got: unknown[], count: number, ms = 2000) => {
    const end = Date.now() + ms;
    while (got.length < count && Date.now() < end) await sleep(20);
  };

  async function setup() {
    const categoryId = (await createCategory()).id as string;
    const annCookie = await loginCookie("ann@example.com");
    const bobCookie = await loginCookie("bob@example.com");
    const rootCookie = await loginCookie("root@example.com", "admin");
    const asAgent = (cookie: string) => makeAgent().set("Cookie", `nb_access=${cookie}`);
    const anon = listen(await connected(client()));
    const ann = listen(await connected(client({ cookie: annCookie })));
    const bob = listen(await connected(client({ cookie: bobCookie })));
    const root = listen(await connected(client({ cookie: rootCookie })));
    return {
      categoryId,
      anon,
      ann,
      bob,
      root,
      annApi: asAgent(annCookie),
      rootApi: asAgent(rootCookie),
    };
  }
  const names = (got: { event: string }[]) => got.map((g) => g.event);

  it("sends a published notice to everyone within 2 seconds, with no private fields", async () => {
    const t = await setup();
    const res = await t.annApi.post("/api/notices").send(noticeBody(t.categoryId));
    expect(res.status).toBe(201);
    await waitFor(t.anon, 1);
    expect(names(t.anon)).toEqual(["notice:created"]);
    expect(t.anon[0]!.data.id).toBe(res.body.notice.id);
    expect(t.anon[0]!.data.status).toBeUndefined();
    expect(t.anon[0]!.data.authorId).toBeUndefined();
    await waitFor(t.ann, 2);
    expect(names(t.ann).sort()).toEqual(["notice:changed", "notice:created"]);
    expect(names(t.root).sort()).toEqual(["notice:changed", "notice:created"]);
    expect(names(t.bob)).toEqual(["notice:created"]);
  });

  it("never sends a draft to the public or to other committee members", async () => {
    const t = await setup();
    const res = await t.annApi
      .post("/api/notices")
      .send(noticeBody(t.categoryId, { status: "draft" }));
    await waitFor(t.ann, 1);
    await waitFor(t.root, 1);
    await sleep(150);
    expect(names(t.ann)).toEqual(["notice:changed"]);
    expect(t.ann[0]!.data.status).toBe("draft");
    expect(names(t.root)).toEqual(["notice:changed"]);
    expect(t.anon).toEqual([]);
    expect(t.bob).toEqual([]);
    expect(res.body.notice.status).toBe("draft");
  });

  it("sends edits and pins as updates, and archive and delete as removals", async () => {
    const t = await setup();
    const id = (await t.annApi.post("/api/notices").send(noticeBody(t.categoryId))).body.notice.id;
    await waitFor(t.anon, 1);
    t.anon.length = 0;

    await t.annApi.patch(`/api/notices/${id}`).send({ title: "Changed" });
    await waitFor(t.anon, 1);
    await t.rootApi.post(`/api/notices/${id}/pin`).send({ pinned: true });
    await waitFor(t.anon, 2);
    expect(names(t.anon)).toEqual(["notice:updated", "notice:updated"]);
    expect(t.anon[1]!.data.pinned).toBe(true);

    await t.annApi.delete(`/api/notices/${id}`).query({ mode: "archive" });
    await waitFor(t.anon, 3);
    expect(t.anon[2]).toEqual({ event: "notice:removed", data: { id } });

    const id2 = (await t.annApi.post("/api/notices").send(noticeBody(t.categoryId))).body.notice.id;
    await waitFor(t.anon, 4);
    await t.annApi.delete(`/api/notices/${id2}`).query({ mode: "delete" });
    await waitFor(t.anon, 5);
    expect(t.anon[4]).toEqual({ event: "notice:removed", data: { id: id2 } });
  });

  it("sends changes to an archived notice only to its author and admins", async () => {
    const t = await setup();
    const id = (await t.annApi.post("/api/notices").send(noticeBody(t.categoryId))).body.notice.id;
    await waitFor(t.anon, 1);
    await t.annApi.delete(`/api/notices/${id}`).query({ mode: "archive" });
    await waitFor(t.anon, 2);
    // The public only learns that it is gone (an id, no content).
    expect(t.anon[1]).toEqual({ event: "notice:removed", data: { id } });
    for (const got of [t.anon, t.bob, t.ann, t.root]) got.length = 0;

    await t.annApi.patch(`/api/notices/${id}`).send({ title: "Edited while archived" });
    await waitFor(t.ann, 1);
    await waitFor(t.root, 1);
    await sleep(150);
    expect(names(t.ann)).toEqual(["notice:changed"]);
    expect(names(t.root)).toEqual(["notice:changed"]);
    expect(t.ann[0]!.data.status).toBe("archived");
    expect(t.anon).toEqual([]);
    expect(t.bob).toEqual([]);
  });

  it("announces unpublishing as a removal and republishing as a creation", async () => {
    const t = await setup();
    const id = (await t.annApi.post("/api/notices").send(noticeBody(t.categoryId))).body.notice.id;
    await waitFor(t.anon, 1);
    await t.annApi.patch(`/api/notices/${id}`).send({ status: "draft" });
    await waitFor(t.anon, 2);
    await t.annApi.patch(`/api/notices/${id}`).send({ status: "published" });
    await waitFor(t.anon, 3);
    expect(names(t.anon)).toEqual(["notice:created", "notice:removed", "notice:created"]);
    expect(names(t.bob)).toEqual(names(t.anon));
  });

  it("does not fail a request when nothing is listening", async () => {
    const categoryId = (await createCategory()).id as string;
    const cookie = await loginCookie("ann@example.com");
    const res = await makeAgent()
      .set("Cookie", `nb_access=${cookie}`)
      .post("/api/notices")
      .send(noticeBody(categoryId));
    expect(res.status).toBe(201);
  });
});
