import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Notice } from "../src/models/Notice.js";
import {
  clearTestDb,
  connectTestDb,
  PASSWORD,
  createCategory,
  createUser,
  disconnectTestDb,
  makeAgent,
  noticeBody,
  signedIn,
  testEnv,
} from "./helpers.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
// Trailing bytes after a valid PNG are ignored by type detection; they make the file span several
// GridFS chunks (255 KB each) so the round trip is a real integrity check.
const bigPng = () => Buffer.concat([PNG, randomBytes(600_000)]);
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from("WEBPVP8 "),
  Buffer.alloc(32),
]);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const anon = () => makeAgent();

type Agent = Awaited<ReturnType<typeof signedIn>>["agent"];
const upload = (
  agent: Agent,
  file: Buffer,
  filename = "pic.png",
  contentType = "image/png",
  alt = "A picture",
) => agent.post("/api/images").field("alt", alt).attach("file", file, { filename, contentType });

describe("images API", () => {
  let categoryId: string;

  beforeAll(connectTestDb);
  beforeEach(async () => {
    categoryId = (await createCategory()).id;
  });
  afterEach(clearTestDb);
  afterAll(async () => {
    await mongoose.connection.db!.collection("images.files").deleteMany({});
    await mongoose.connection.db!.collection("images.chunks").deleteMany({});
    await disconnectTestDb();
  });

  const publish = async (agent: Agent, fileIds: string[], extra: Record<string, unknown> = {}) =>
    agent.post("/api/notices").send(
      noticeBody(categoryId, {
        images: fileIds.map((fileId) => ({ fileId, alt: "pic" })),
        ...extra,
      }),
    );

  describe("upload", () => {
    it("needs a signed-in committee member or admin and the app's Origin", async () => {
      expect((await upload(anon(), PNG)).status).toBe(401);
      await createUser("ann@example.com");
      const browser = request.agent(createApp(testEnv));
      await browser
        .post("/api/auth/login")
        .set("Origin", testEnv.APP_ORIGIN)
        .send({ email: "ann@example.com", password: PASSWORD });
      // Signed in, but the upload comes without the app's Origin header.
      const res = await browser.post("/api/images").field("alt", "x").attach("file", PNG, "p.png");
      expect(res.status).toBe(403);
    });

    it("stores and serves the exact bytes uploaded (multi-chunk file, same SHA-256)", async () => {
      const { agent } = await signedIn("ann@example.com");
      const original = bigPng();
      const up = await upload(agent, original);
      expect(up.status).toBe(201);
      expect(up.body).toMatchObject({ alt: "A picture" });

      const down = await agent
        .get(`/api/images/${up.body.fileId}`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => cb(null, Buffer.concat(chunks)));
        });
      expect(down.status).toBe(200);
      expect(down.headers["content-type"]).toBe("image/png");
      expect(down.headers["x-content-type-options"]).toBe("nosniff");
      expect(down.headers["content-length"]).toBe(String(original.length));
      expect(sha(down.body as Buffer)).toBe(sha(original));
    });

    it("accepts JPEG and WebP and records the real type", async () => {
      const { agent } = await signedIn("ann@example.com");
      const jpg = await upload(agent, JPEG, "a.jpg", "image/jpeg");
      const webp = await upload(agent, WEBP, "a.webp", "image/webp");
      expect(jpg.status).toBe(201);
      expect(webp.status).toBe(201);
      expect((await agent.get(`/api/images/${jpg.body.fileId}`)).headers["content-type"]).toBe(
        "image/jpeg",
      );
      expect((await agent.get(`/api/images/${webp.body.fileId}`)).headers["content-type"]).toBe(
        "image/webp",
      );
    });

    it("decides the type from the bytes, not the name or declared type", async () => {
      const { agent } = await signedIn("ann@example.com");
      const disguised = [
        Buffer.from("just some text"),
        Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"),
        Buffer.from("<html><script>alert(1)</script></html>"),
        Buffer.from("%PDF-1.4 fake"),
      ];
      for (const file of disguised) {
        const res = await upload(agent, file, "innocent.png", "image/png");
        expect(res.status).toBe(400);
        expect(res.body.error.fields.file).toBeTruthy();
      }
    });

    it("rejects files over the size limit with 413", async () => {
      const { agent } = await signedIn("ann@example.com");
      const huge = Buffer.concat([PNG, Buffer.alloc(testEnv.MAX_IMAGE_MB * 1024 * 1024)]);
      expect((await upload(agent, huge)).status).toBe(413);
    });

    it("requires a file named 'file' and alt text", async () => {
      const { agent } = await signedIn("ann@example.com");
      expect((await agent.post("/api/images").field("alt", "x")).status).toBe(400);
      expect((await upload(agent, PNG, "p.png", "image/png", "  ")).status).toBe(400);
      const wrongField = await agent
        .post("/api/images")
        .field("alt", "x")
        .attach("photo", PNG, "p.png");
      expect(wrongField.status).toBe(400);
    });
  });

  describe("who can read an image", () => {
    it("public notice: anyone, with long-lived caching and an ETag that gives 304", async () => {
      const ann = await signedIn("ann@example.com");
      const { fileId } = (await upload(ann.agent, PNG)).body;
      expect((await publish(ann.agent, [fileId])).status).toBe(201);

      const res = await anon().get(`/api/images/${fileId}`);
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toMatch(/public.*immutable/);
      const cached = await anon()
        .get(`/api/images/${fileId}`)
        .set("If-None-Match", res.headers.etag!);
      expect(cached.status).toBe(304);
    });

    it("draft notice: author and admin only", async () => {
      const ann = await signedIn("ann@example.com");
      const ben = await signedIn("ben@example.com");
      const admin = await signedIn("root@example.com", "admin");
      const { fileId } = (await upload(ann.agent, PNG)).body;
      await publish(ann.agent, [fileId], { status: "draft" });

      expect((await anon().get(`/api/images/${fileId}`)).status).toBe(404);
      expect((await ben.agent.get(`/api/images/${fileId}`)).status).toBe(404);
      const own = await ann.agent.get(`/api/images/${fileId}`);
      expect(own.status).toBe(200);
      expect(own.headers["cache-control"]).toMatch(/private/);
      expect((await admin.agent.get(`/api/images/${fileId}`)).status).toBe(200);
    });

    it("not yet attached: uploader and admin only", async () => {
      const ann = await signedIn("ann@example.com");
      const ben = await signedIn("ben@example.com");
      const admin = await signedIn("root@example.com", "admin");
      const { fileId } = (await upload(ann.agent, PNG)).body;
      expect((await anon().get(`/api/images/${fileId}`)).status).toBe(404);
      expect((await ben.agent.get(`/api/images/${fileId}`)).status).toBe(404);
      expect((await ann.agent.get(`/api/images/${fileId}`)).status).toBe(200);
      expect((await admin.agent.get(`/api/images/${fileId}`)).status).toBe(200);
    });

    it("expired or archived notice hides its images from the public", async () => {
      const ann = await signedIn("ann@example.com");
      const { fileId } = (await upload(ann.agent, PNG)).body;
      const id = (await publish(ann.agent, [fileId])).body.notice.id;
      await Notice.updateOne({ _id: id }, { expiresAt: new Date(Date.now() - 1000) });
      expect((await anon().get(`/api/images/${fileId}`)).status).toBe(404);
    });

    it("unknown and malformed ids are 404", async () => {
      expect((await anon().get("/api/images/507f1f77bcf86cd799439011")).status).toBe(404);
      expect((await anon().get("/api/images/not-an-id")).status).toBe(404);
    });
  });

  describe("attaching to notices", () => {
    it("shows attached images on the notice and lets the public fetch them", async () => {
      const ann = await signedIn("ann@example.com");
      const a = (await upload(ann.agent, PNG)).body.fileId;
      const b = (await upload(ann.agent, JPEG, "b.jpg", "image/jpeg")).body.fileId;
      const res = await publish(ann.agent, [a, b]);
      expect(res.status).toBe(201);
      expect(res.body.notice.images.map((i: { id: string }) => i.id)).toEqual([a, b]);
      const pub = await anon().get(`/api/notices/${res.body.notice.id}`);
      expect(pub.body.notice.images).toHaveLength(2);
    });

    it("refuses unknown, duplicate, foreign, already-used and too many images", async () => {
      const ann = await signedIn("ann@example.com");
      const ben = await signedIn("ben@example.com");
      const mine = (await upload(ann.agent, PNG)).body.fileId;
      const theirs = (await upload(ben.agent, PNG)).body.fileId;

      expect((await publish(ann.agent, ["507f1f77bcf86cd799439011"])).status).toBe(400);
      expect((await publish(ann.agent, [mine, mine])).status).toBe(400);
      expect((await publish(ann.agent, [theirs])).body.error.fields.images).toMatch(/another user/);

      expect((await publish(ann.agent, [mine])).status).toBe(201);
      expect((await publish(ann.agent, [mine])).body.error.fields.images).toMatch(/already used/);

      const six: string[] = [];
      for (let i = 0; i < 6; i++) six.push((await upload(ann.agent, PNG)).body.fileId);
      expect((await publish(ann.agent, six)).status).toBe(400);
      expect((await publish(ann.agent, six.slice(0, 5))).status).toBe(201);
    });

    it("replaces the image list on edit and deletes the dropped files", async () => {
      const ann = await signedIn("ann@example.com");
      const a = (await upload(ann.agent, PNG)).body.fileId;
      const b = (await upload(ann.agent, PNG)).body.fileId;
      const id = (await publish(ann.agent, [a])).body.notice.id;

      const edited = await ann.agent
        .patch(`/api/notices/${id}`)
        .send({ images: [{ fileId: b, alt: "new" }] });
      expect(edited.status).toBe(200);
      expect(edited.body.notice.images).toEqual([{ id: b, alt: "new" }]);
      expect((await ann.agent.get(`/api/images/${a}`)).status).toBe(404);
      expect((await anon().get(`/api/images/${b}`)).status).toBe(200);
      const cleared = await ann.agent.patch(`/api/notices/${id}`).send({ images: [] });
      expect(cleared.body.notice.images).toEqual([]);
      expect((await ann.agent.get(`/api/images/${b}`)).status).toBe(404);
    });

    it("deleting a notice deletes its images; archiving keeps them", async () => {
      const ann = await signedIn("ann@example.com");
      const a = (await upload(ann.agent, PNG)).body.fileId;
      const id = (await publish(ann.agent, [a])).body.notice.id;
      await ann.agent.delete(`/api/notices/${id}?mode=archive`);
      expect((await ann.agent.get(`/api/images/${a}`)).status).toBe(200);
      await ann.agent.delete(`/api/notices/${id}`);
      expect((await ann.agent.get(`/api/images/${a}`)).status).toBe(404);
    });
  });

  describe("DELETE /api/images/:id", () => {
    it("lets the uploader, the notice author and admin delete; others get 403; anonymous 401", async () => {
      const ann = await signedIn("ann@example.com");
      const ben = await signedIn("ben@example.com");
      const admin = await signedIn("root@example.com", "admin");

      const a = (await upload(ann.agent, PNG)).body.fileId;
      expect((await anon().delete(`/api/images/${a}`)).status).toBe(401);
      expect((await ben.agent.delete(`/api/images/${a}`)).status).toBe(403);
      expect((await ann.agent.delete(`/api/images/${a}`)).status).toBe(204);

      const b = (await upload(ann.agent, PNG)).body.fileId;
      const id = (await publish(ann.agent, [b])).body.notice.id;
      expect((await admin.agent.delete(`/api/images/${b}`)).status).toBe(204);
      expect((await ann.agent.get(`/api/notices/${id}`)).body.notice.images).toEqual([]);
      expect((await ann.agent.delete(`/api/images/${b}`)).status).toBe(404);
    });
  });
});
