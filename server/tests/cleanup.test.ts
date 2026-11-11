import mongoose from "mongoose";
import { cleanup } from "../../scripts/cleanup.js";
import { Notice } from "../src/models/Notice.js";
import {
  clearTestDb,
  connectTestDb,
  createCategory,
  disconnectTestDb,
  noticeBody,
  signedIn,
} from "./helpers.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const DAY = 86_400_000;
const files = () => mongoose.connection.db!.collection("images.files");

describe("cleanup script", () => {
  let categoryId: string;
  let ann: Awaited<ReturnType<typeof signedIn>>;

  beforeAll(connectTestDb);
  beforeEach(async () => {
    categoryId = (await createCategory()).id;
    ann = await signedIn("ann@example.com");
  });
  afterEach(clearTestDb);
  afterAll(disconnectTestDb);

  const upload = async () =>
    (
      await ann.agent
        .post("/api/images")
        .field("alt", "pic")
        .attach("file", PNG, { filename: "p.png", contentType: "image/png" })
    ).body.fileId as string;

  /** A published notice with one image; expiry is set directly because the API refuses the past. */
  const noticeWithImage = async (expiresAt: Date | null) => {
    const fileId = await upload();
    const res = await ann.agent
      .post("/api/notices")
      .send(noticeBody(categoryId, { images: [{ fileId, alt: "pic" }] }));
    await Notice.updateOne({ _id: res.body.notice.id }, { expiresAt });
    return { id: res.body.notice.id as string, fileId };
  };
  const fileExists = async (id: string) =>
    (await files().countDocuments({ _id: new mongoose.Types.ObjectId(id) })) === 1;

  it("removes notices expired over a year ago with their images, and keeps the rest", async () => {
    const now = new Date();
    const old = await noticeWithImage(new Date(now.getTime() - 400 * DAY));
    const recent = await noticeWithImage(new Date(now.getTime() - 30 * DAY));
    const open = await noticeWithImage(null);

    const result = await cleanup({ now });
    expect(result).toMatchObject({ notices: 1, noticeImages: 1, unattachedImages: 0 });
    expect(await Notice.findById(old.id)).toBeNull();
    expect(await fileExists(old.fileId)).toBe(false);
    expect(await Notice.findById(recent.id)).not.toBeNull();
    expect(await fileExists(recent.fileId)).toBe(true);
    expect(await Notice.findById(open.id)).not.toBeNull();
    expect(await fileExists(open.fileId)).toBe(true);
  });

  it("removes images never attached to a notice only after a day", async () => {
    const abandoned = await upload();
    const now = new Date();
    expect((await cleanup({ now })).unattachedImages).toBe(0); // just uploaded
    expect(await fileExists(abandoned)).toBe(true);

    const later = new Date(now.getTime() + 2 * DAY);
    expect((await cleanup({ now: later })).unattachedImages).toBe(1);
    expect(await fileExists(abandoned)).toBe(false);
  });

  it("never touches an image that is attached to a notice, however old", async () => {
    const { fileId } = await noticeWithImage(null);
    const result = await cleanup({ now: new Date(Date.now() + 800 * DAY) });
    expect(result.unattachedImages).toBe(0);
    expect(await fileExists(fileId)).toBe(true);
  });

  it("dry run only counts, and a second real run finds nothing more", async () => {
    const old = await noticeWithImage(new Date(Date.now() - 400 * DAY));
    await upload();
    const later = new Date(Date.now() + 2 * DAY);

    const dry = await cleanup({ now: later, dryRun: true });
    expect(dry).toMatchObject({ notices: 1, unattachedImages: 1, dryRun: true });
    expect(await Notice.findById(old.id)).not.toBeNull();
    expect(await fileExists(old.fileId)).toBe(true);

    expect(await cleanup({ now: later })).toMatchObject({ notices: 1, unattachedImages: 1 });
    expect(await cleanup({ now: later })).toMatchObject({ notices: 0, unattachedImages: 0 });
  });
});
