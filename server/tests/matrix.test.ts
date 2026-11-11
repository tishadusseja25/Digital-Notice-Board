import request from "supertest";
import { createApp } from "../src/app.js";
import { Notice } from "../src/models/Notice.js";
import {
  PASSWORD,
  clearTestDb,
  connectTestDb,
  cookieValue,
  createCategory,
  createUser,
  disconnectTestDb,
  makeAgent,
  noticeBody,
  testEnv,
} from "./helpers.js";

/**
 * PRD Section 5 as a test. Every route is called by four callers and the answer must match:
 *   anon   = nobody signed in
 *   author = committee member who owns the notice or image used in the request
 *   other  = a different committee member
 *   admin  = admin
 * A guard at the end fails when the app has a route that no row here covers.
 */
type Role = "anon" | "author" | "other" | "admin";
const ROLES: Role[] = ["anon", "author", "other", "admin"];

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const EMAILS = { author: "ann@example.com", other: "bob@example.com", admin: "root@example.com" };

type Ctx = {
  pub: () => Promise<string>;
  draft: () => Promise<string>;
  archived: () => Promise<string>;
  expired: () => Promise<string>;
  imgPub: () => Promise<string>;
  imgDraft: () => Promise<string>;
  imgLoose: () => Promise<string>;
  category: () => Promise<string>;
  victim: () => Promise<string>;
  email: (role: Role) => string;
};
type Spec = {
  method: "get" | "post" | "patch" | "delete";
  url: string;
  body?: object;
  file?: boolean;
};
type Row = {
  route: string; // "METHOD /mounted/path/:id", as the app registers it
  what: string;
  spec: (c: Ctx) => Promise<Spec> | Spec;
  expect: [anon: number, author: number, other: number, admin: number];
};

const get = (url: string): Spec => ({ method: "get", url });
const ALL = (n: number): Row["expect"] => [n, n, n, n];
const STAFF_ONLY: Row["expect"] = [401, 201, 201, 201];

const rows: Row[] = [
  {
    route: "GET /api/health",
    what: "health check",
    spec: () => get("/api/health"),
    expect: ALL(200),
  },

  // --- sign-in and own account
  {
    route: "POST /api/auth/login",
    what: "sign in with correct credentials",
    spec: (c) => ({
      method: "post",
      url: "/api/auth/login",
      body: { email: c.email("author"), password: PASSWORD },
    }),
    expect: ALL(200),
  },
  {
    route: "POST /api/auth/refresh",
    what: "refresh without a refresh cookie",
    spec: () => ({ method: "post", url: "/api/auth/refresh" }),
    expect: ALL(401),
  },
  {
    route: "POST /api/auth/logout",
    what: "sign out (harmless when signed out)",
    spec: () => ({ method: "post", url: "/api/auth/logout" }),
    expect: ALL(204),
  },
  {
    route: "GET /api/auth/me",
    what: "read own profile",
    spec: () => get("/api/auth/me"),
    expect: [401, 200, 200, 200],
  },
  {
    route: "POST /api/auth/password",
    what: "change own password",
    spec: () => ({
      method: "post",
      url: "/api/auth/password",
      body: { current: PASSWORD, next: "a-brand-new-password" },
    }),
    expect: [401, 204, 204, 204],
  },

  // --- reading notices
  {
    route: "GET /api/notices",
    what: "public board",
    spec: () => get("/api/notices"),
    expect: ALL(200),
  },
  {
    route: "GET /api/notices/:id",
    what: "read a published notice",
    spec: async (c) => get(`/api/notices/${await c.pub()}`),
    expect: ALL(200),
  },
  {
    route: "GET /api/notices/:id",
    what: "read a draft",
    spec: async (c) => get(`/api/notices/${await c.draft()}`),
    expect: [404, 200, 404, 200],
  },
  {
    route: "GET /api/notices/:id",
    what: "read an archived notice",
    spec: async (c) => get(`/api/notices/${await c.archived()}`),
    expect: [404, 200, 404, 200],
  },
  {
    route: "GET /api/notices/:id",
    what: "read an expired notice",
    spec: async (c) => get(`/api/notices/${await c.expired()}`),
    expect: [404, 200, 404, 200],
  },
  {
    route: "GET /api/me/notices",
    what: "list my notices",
    spec: () => get("/api/me/notices"),
    expect: [401, 200, 200, 200],
  },

  // --- writing notices
  {
    route: "POST /api/notices",
    what: "create a notice",
    spec: async (c) => ({
      method: "post",
      url: "/api/notices",
      body: noticeBody(await c.category()),
    }),
    expect: STAFF_ONLY,
  },
  {
    route: "PATCH /api/notices/:id",
    what: "edit a published notice",
    spec: async (c) => ({
      method: "patch",
      url: `/api/notices/${await c.pub()}`,
      body: { title: "Changed" },
    }),
    expect: [401, 200, 403, 200],
  },
  {
    route: "PATCH /api/notices/:id",
    what: "edit a draft",
    spec: async (c) => ({
      method: "patch",
      url: `/api/notices/${await c.draft()}`,
      body: { title: "Changed" },
    }),
    expect: [401, 200, 403, 200],
  },
  {
    route: "DELETE /api/notices/:id",
    what: "delete a notice",
    spec: async (c) => ({ method: "delete", url: `/api/notices/${await c.pub()}` }),
    expect: [401, 204, 403, 204],
  },
  {
    route: "DELETE /api/notices/:id",
    what: "archive a draft",
    spec: async (c) => ({ method: "delete", url: `/api/notices/${await c.draft()}?mode=archive` }),
    expect: [401, 204, 403, 204],
  },
  {
    route: "POST /api/notices/:id/pin",
    what: "pin a notice (admin only, even for the owner)",
    spec: async (c) => ({
      method: "post",
      url: `/api/notices/${await c.pub()}/pin`,
      body: { pinned: true },
    }),
    expect: [401, 403, 403, 200],
  },

  // --- images
  {
    route: "POST /api/images",
    what: "upload an image",
    spec: () => ({ method: "post", url: "/api/images", file: true }),
    expect: STAFF_ONLY,
  },
  {
    route: "GET /api/images/:id",
    what: "image of a public notice",
    spec: async (c) => get(`/api/images/${await c.imgPub()}`),
    expect: ALL(200),
  },
  {
    route: "GET /api/images/:id",
    what: "image of a draft",
    spec: async (c) => get(`/api/images/${await c.imgDraft()}`),
    expect: [404, 200, 404, 200],
  },
  {
    route: "GET /api/images/:id",
    what: "uploaded image not yet on a notice",
    spec: async (c) => get(`/api/images/${await c.imgLoose()}`),
    expect: [404, 200, 404, 200],
  },
  {
    route: "DELETE /api/images/:id",
    what: "delete an image on a published notice",
    spec: async (c) => ({ method: "delete", url: `/api/images/${await c.imgPub()}` }),
    expect: [401, 204, 403, 204],
  },
  {
    route: "DELETE /api/images/:id",
    what: "delete an unattached image",
    spec: async (c) => ({ method: "delete", url: `/api/images/${await c.imgLoose()}` }),
    expect: [401, 204, 403, 204],
  },

  // --- categories
  {
    route: "GET /api/categories",
    what: "list categories",
    spec: () => get("/api/categories"),
    expect: ALL(200),
  },
  {
    route: "POST /api/categories",
    what: "create a category",
    spec: () => ({ method: "post", url: "/api/categories", body: { name: "Sports" } }),
    expect: [401, 403, 403, 201],
  },
  {
    route: "PATCH /api/categories/:id",
    what: "rename a category",
    spec: async (c) => ({
      method: "patch",
      url: `/api/categories/${await c.category()}`,
      body: { name: "Renamed" },
    }),
    expect: [401, 403, 403, 200],
  },
  {
    route: "DELETE /api/categories/:id",
    what: "delete an unused category",
    spec: async (c) => ({ method: "delete", url: `/api/categories/${await c.category()}` }),
    expect: [401, 403, 403, 204],
  },

  // --- users and audit (admin only)
  {
    route: "GET /api/users",
    what: "list users",
    spec: () => get("/api/users"),
    expect: [401, 403, 403, 200],
  },
  {
    route: "POST /api/users",
    what: "create a user",
    spec: () => ({
      method: "post",
      url: "/api/users",
      body: {
        name: "New",
        email: "new@example.com",
        role: "committee",
        password: "a-long-temporary-pw",
      },
    }),
    expect: [401, 403, 403, 201],
  },
  {
    route: "PATCH /api/users/:id",
    what: "disable a user",
    spec: async (c) => ({
      method: "patch",
      url: `/api/users/${await c.victim()}`,
      body: { active: false },
    }),
    expect: [401, 403, 403, 200],
  },
  {
    route: "GET /api/audit",
    what: "read the audit log",
    spec: () => get("/api/audit"),
    expect: [401, 403, 403, 200],
  },
];

describe("access control matrix (PRD Section 5)", () => {
  const cookies = {} as Record<"author" | "other" | "admin", string>;
  let n = 0;

  /** A fresh app per call keeps rate-limit counters from piling up across the many requests here. */
  const as = (cookie?: string) => {
    const agent = makeAgent();
    return cookie ? agent.set("Cookie", `nb_access=${cookie}`) : agent;
  };
  const agentFor = (role: Role) => as(role === "anon" ? undefined : cookies[role]);

  beforeAll(connectTestDb);
  beforeEach(async () => {
    await clearTestDb();
    for (const [role, email] of Object.entries(EMAILS)) {
      await createUser(email, role === "admin" ? "admin" : "committee");
      const res = await makeAgent().post("/api/auth/login").send({ email, password: PASSWORD });
      cookies[role as keyof typeof cookies] = cookieValue(res, "nb_access")!;
    }
  });
  afterAll(disconnectTestDb);

  /** Test data owned by the "author", created on demand so each cell starts clean. */
  function context(): Ctx {
    const memo = new Map<string, Promise<string>>();
    const once = (key: string, make: () => Promise<string>) => () => {
      if (!memo.has(key)) memo.set(key, make());
      return memo.get(key)!;
    };
    const owner = () => as(cookies.author);
    const category = once(
      "category",
      async () => (await createCategory(`Cat ${++n}`)).id as string,
    );
    const notice = async (extra: Record<string, unknown> = {}) =>
      (
        await owner()
          .post("/api/notices")
          .send(noticeBody(await category(), extra))
      ).body.notice.id as string;
    const upload = async () =>
      (
        await owner()
          .post("/api/images")
          .field("alt", "pic")
          .attach("file", PNG, { filename: "p.png", contentType: "image/png" })
      ).body.fileId as string;
    const withImage = async (status: string) => {
      const fileId = await upload();
      await notice({ status, images: [{ fileId, alt: "pic" }] });
      return fileId;
    };
    return {
      category,
      pub: once("pub", () => notice()),
      draft: once("draft", () => notice({ status: "draft" })),
      archived: once("archived", async () => {
        const id = await notice();
        await owner().delete(`/api/notices/${id}`).query({ mode: "archive" });
        return id;
      }),
      expired: once("expired", async () => {
        const id = await notice();
        await Notice.updateOne({ _id: id }, { expiresAt: new Date(Date.now() - 1000) });
        return id;
      }),
      imgPub: once("imgPub", () => withImage("published")),
      imgDraft: once("imgDraft", () => withImage("draft")),
      imgLoose: once("imgLoose", upload),
      victim: once(
        "victim",
        async () => (await createUser(`victim${++n}@example.com`)).id as string,
      ),
      email: (role) => (role === "anon" ? EMAILS.author : EMAILS[role]),
    };
  }

  it.each(rows)("$route: $what", async (row) => {
    const results: number[] = [];
    for (const role of ROLES) {
      const ctx = context(); // fresh data for every caller, so deleting in one cell does not affect the next
      const spec = await row.spec(ctx);
      let req = (agentFor(role) as unknown as Record<string, (u: string) => request.Test>)[
        spec.method
      ]!(spec.url);
      if (spec.file)
        req = req
          .field("alt", "pic")
          .attach("file", PNG, { filename: "p.png", contentType: "image/png" });
      else if (spec.body) req = req.send(spec.body);
      results.push((await req).status);
    }
    expect(results, `[anon, author, other, admin] for ${row.route}`).toEqual(row.expect);
  });

  it("covers every route the app registers (add new routes to the table above)", () => {
    type Layer = {
      route?: { path: string; methods: Record<string, boolean> };
      handle?: { stack?: Layer[] };
      regexp?: RegExp;
    };
    const stack = (createApp(testEnv) as unknown as { _router: { stack: Layer[] } })._router.stack;
    const registered = new Set<string>();
    for (const layer of stack) {
      for (const inner of layer.handle?.stack ?? []) {
        if (!inner.route || !layer.regexp) continue;
        // Express stores a mount like /api/notices as the pattern ^\/api\/notices\/?(?=\/|$)
        const mount = layer.regexp.source
          .replace(/^\^/, "")
          .replace("\\/?(?=\\/|$)", "")
          .replace(/\\\//g, "/");
        const path = inner.route.path === "/" ? "" : inner.route.path;
        for (const method of Object.keys(inner.route.methods)) {
          registered.add(`${method.toUpperCase()} ${mount}${path}`);
        }
      }
    }
    expect(registered.size).toBeGreaterThan(20);
    const covered = new Set(rows.map((r) => r.route));
    expect([...registered].filter((r) => !covered.has(r))).toEqual([]);
    expect([...covered].filter((r) => !registered.has(r))).toEqual([]);
  });
});
