import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import mongoose, { Types, trusted } from "mongoose";
import { Category } from "../server/src/models/Category.js";
import { Notice } from "../server/src/models/Notice.js";
import { RefreshToken } from "../server/src/models/RefreshToken.js";
import { AuditLog } from "../server/src/models/AuditLog.js";
import { User } from "../server/src/models/User.js";

/**
 * Fills the database with demo people and notices so the board looks lived in: 3 admins,
 * 14 committee members, 10 categories, about 180 notices in every state (published, expiring soon,
 * expired, draft, archived, pinned) and generated poster images stored in GridFS.
 * Everything demo-made uses the email domain below, so `--reset` can remove exactly that.
 */
export const DEMO_DOMAIN = "demo.college.test";
export const DEMO_PASSWORD = "Demo-pass-2026";

const ADMINS = ["Meera Iyer", "Arjun Nair", "Sana Qureshi"];
const COMMITTEE = [
  "Rohan Deshmukh",
  "Priya Menon",
  "Kabir Singh",
  "Ananya Rao",
  "Farhan Sheikh",
  "Isha Kulkarni",
  "Vikram Joshi",
  "Neha Pillai",
  "Aditya Verma",
  "Tanvi Shah",
  "Rahul Bhatt",
  "Divya Nambiar",
  "Sameer Khan",
  "Pooja Reddy",
];
const CATEGORIES = [
  "General",
  "Exams",
  "Events",
  "Placements",
  "Sports",
  "Library",
  "Hostel",
  "Scholarships",
  "Clubs",
  "Holidays",
];
// Poster colour per category (hue in degrees), so the generated images match the board's colour coding.
const HUE: Record<string, number> = {
  General: 215,
  Exams: 5,
  Events: 270,
  Placements: 150,
  Sports: 28,
  Library: 190,
  Hostel: 330,
  Scholarships: 50,
  Clubs: 300,
  Holidays: 100,
};
const DEPTS = [
  "Computer",
  "Mechanical",
  "Electronics",
  "Civil",
  "Information Technology",
  "Chemical",
];
const HALLS = [
  "Seminar Hall A",
  "Main Auditorium",
  "Room 204",
  "Lab 3",
  "Open Air Theatre",
  "Library Annex",
];

const slug = (n: string) => n.toLowerCase().replace(/[^a-z]+/g, ".");

// Small deterministic random numbers: the same data every run.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx = { r: () => number; now: Date };
const pick = <T>(c: Ctx, list: T[]): T => list[Math.floor(c.r() * list.length)]!;
const DAY = 86_400_000;
const dayLabel = (d: Date) =>
  d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
const inDays = (c: Ctx, from: number, to: number) =>
  new Date(c.now.getTime() + (from + c.r() * (to - from)) * DAY);

type Template = (c: Ctx) => { title: string; body: string };
const TEMPLATES: Record<string, Template[]> = {
  General: [
    (c) => ({
      title: "ID cards for new students",
      body: `New students can collect their ID cards from the administration office between 10 am and 4 pm, starting ${dayLabel(inDays(c, 1, 5))}.\n\nBring your fee receipt and one passport photo. Cards not collected within two weeks will be sent to the department office.`,
    }),
    (c) => ({
      title: "Campus Wi-Fi maintenance window",
      body: `The campus network will be offline on ${dayLabel(inDays(c, 2, 9))} from 11 pm to 5 am for an upgrade.\n\nHostel residents should save work before 11 pm. The library terminals stay on the wired network.`,
    }),
    (c) => ({
      title: `${pick(c, DEPTS)} department: change of office hours`,
      body: "The department office is now open from 9:30 am to 3:30 pm on weekdays. Requests for bonafide certificates are handled until 2 pm.",
    }),
    () => ({
      title: "Lost and found: items at the security desk",
      body: "Several items found on campus this month are at the main gate security desk: two water bottles, a grey jacket, a calculator and a set of keys with a blue tag.\n\nCollect them by showing your ID card.",
    }),
  ],
  Exams: [
    (c) => ({
      title: `${pick(c, DEPTS)} mid-semester exam timetable`,
      body: `The mid-semester examinations begin on ${dayLabel(inDays(c, 4, 12))}. The full timetable is displayed outside the examination cell.\n\nCarry your ID card and hall ticket. Mobile phones are not allowed inside the hall.`,
    }),
    (c) => ({
      title: "Hall tickets available for download",
      body: `Hall tickets for the end-semester examination are available on the student portal from ${dayLabel(inDays(c, 1, 4))}.\n\nStudents with pending fees must clear dues at the accounts office before the ticket can be downloaded.`,
    }),
    (c) => ({
      title: "Revised syllabus for Data Structures",
      body: `The department has revised the syllabus for Data Structures from this semester. Units 4 and 5 are interchanged and graph algorithms now carry more weight.\n\nThe updated outline is in the department library. Questions go to the course coordinator by ${dayLabel(inDays(c, 3, 8))}.`,
    }),
    (c) => ({
      title: "Re-evaluation applications open",
      body: `Students who want re-evaluation of last semester's papers can apply at the examination cell until ${dayLabel(inDays(c, 2, 6))}.\n\nThe fee is 500 rupees per paper and is refunded if marks change.`,
    }),
  ],
  Events: [
    (c) => ({
      title: "Annual tech fest: registrations open",
      body: `The annual technical festival takes place on ${dayLabel(inDays(c, 12, 30))} in ${pick(c, HALLS)} and the main ground.\n\nThere are 18 events across coding, robotics, design and quizzes. Team registration closes a week before the fest. Volunteers are welcome; meet the student council on Friday at 4 pm.`,
    }),
    (c) => ({
      title: "Guest lecture: careers in cloud engineering",
      body: `An engineer from an industry partner will talk about cloud and DevOps careers on ${dayLabel(inDays(c, 3, 10))} at 11 am in ${pick(c, HALLS)}.\n\nSeats are first come, first served. Attendance counts towards the seminar credit.`,
    }),
    (c) => ({
      title: "Blood donation camp",
      body: `The NSS unit is holding a blood donation camp on ${dayLabel(inDays(c, 5, 14))} from 9 am to 3 pm.\n\nDonors need to be 18 or older and weigh at least 50 kg. Light refreshments are provided.`,
    }),
    (c) => ({
      title: "Cultural night: auditions this week",
      body: `Auditions for singing, dance and drama are on until ${dayLabel(inDays(c, 1, 4))}, 4 pm to 6 pm in the Main Auditorium. Bring your own track if you need one.`,
    }),
  ],
  Placements: [
    (c) => ({
      title: "Campus drive: software engineer roles",
      body: `A software company will visit on ${dayLabel(inDays(c, 6, 20))} for final-year students of Computer, IT and Electronics.\n\nEligibility: 6.5 CGPA, no active backlogs. Register with the placement cell by ${dayLabel(inDays(c, 2, 5))} and upload an updated resume.`,
    }),
    (c) => ({
      title: "Resume workshop with alumni mentors",
      body: `Alumni from three companies will review resumes one to one on ${dayLabel(inDays(c, 3, 9))}. Each slot is 15 minutes; book at the placement cell.`,
    }),
    () => ({
      title: "Aptitude practice test series",
      body: "A weekly online aptitude test starts next week for all pre-final and final-year students. Results and solutions are shared the next day. Practice on the lab computers if you do not have a laptop.",
    }),
  ],
  Sports: [
    (c) => ({
      title: "Inter-department cricket: fixtures",
      body: `Fixtures for the inter-department cricket tournament are out. The first match is on ${dayLabel(inDays(c, 2, 6))} at 8 am on the main ground.\n\nTeams must submit a squad list of 14 players to the sports office by Thursday.`,
    }),
    () => ({
      title: "Swimming pool timings changed",
      body: "The pool is open 6 am to 8 am and 5 pm to 7 pm. Swim caps are compulsory. Students need a medical fitness note for first-time entry.",
    }),
    (c) => ({
      title: "Selection trials: college football team",
      body: `Trials are held on ${dayLabel(inDays(c, 1, 5))} at 4:30 pm. Wear studs and bring water. Selected players attend practice on weekday mornings.`,
    }),
  ],
  Library: [
    (c) => ({
      title: "Library open until midnight during exams",
      body: `From ${dayLabel(inDays(c, 1, 3))} the reading hall stays open until midnight. Borrowing stays unchanged. Please keep silence and do not reserve seats with bags.`,
    }),
    () => ({
      title: "New arrivals: engineering and design titles",
      body: "More than 120 new books have reached the library, including titles on machine learning, structural design and product design. Ask the librarian for the list.",
    }),
    (c) => ({
      title: "Overdue books: fines waived this month",
      body: `Return overdue books by ${dayLabel(inDays(c, 5, 12))} and the fine is waived. After that date the usual fine applies.`,
    }),
  ],
  Hostel: [
    () => ({
      title: "Hostel mess menu for the coming week",
      body: "A revised menu with more vegetarian options is displayed in the mess hall. Suggestions go in the box near the entrance and are reviewed on Saturday by the mess committee.",
    }),
    (c) => ({
      title: "Room inspection",
      body: `Routine room inspection takes place on ${dayLabel(inDays(c, 2, 7))} between 10 am and 1 pm. Keep rooms tidy and remove electric heaters and extension boards.`,
    }),
    (c) => ({
      title: "Water supply interruption",
      body: `Water supply to Block B will be interrupted on ${dayLabel(inDays(c, 1, 4))} from 9 am to 2 pm for tank cleaning. Please store water in advance.`,
    }),
  ],
  Scholarships: [
    (c) => ({
      title: "State scholarship: last date to apply",
      body: `Students eligible for the state merit scholarship must submit their application and income certificate by ${dayLabel(inDays(c, 4, 12))}.\n\nVisit the scholarship desk in the administration block for the checklist.`,
    }),
    () => ({
      title: "Alumni-funded merit awards",
      body: "The alumni association is offering ten awards of 25,000 rupees for students with outstanding results. Nominations by faculty advisors are due by the end of the month.",
    }),
  ],
  Clubs: [
    () => ({
      title: "Coding club: weekly contest every Saturday",
      body: "Open to all years, no registration needed. The contest runs two hours from 10 am in Lab 3. Winners get a certificate and a place in the college team for the regional contest.",
    }),
    (c) => ({
      title: "Photography club: exhibition submissions",
      body: `Submit up to three prints for the campus exhibition by ${dayLabel(inDays(c, 4, 10))}. Theme: "A day on campus".`,
    }),
    () => ({
      title: "Robotics club: recruitment",
      body: "The robotics club is recruiting first and second-year students. No experience needed; we teach soldering and microcontrollers from scratch. Meet us in the workshop after 4 pm.",
    }),
  ],
  Holidays: [
    (c) => ({
      title: "Holiday on the occasion of the local festival",
      body: `The college will remain closed on ${dayLabel(inDays(c, 3, 10))}. Classes resume the next working day as per the timetable.`,
    }),
    () => ({
      title: "Diwali break schedule",
      body: "The college is closed for the festival break. Hostels remain open for students who cannot travel; inform the warden in writing by Friday.",
    }),
  ],
};

// --- poster images -------------------------------------------------------------------------
const hsl = (h: number, s: number, l: number): [number, number, number] => {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return [f(0), f(8), f(4)];
};
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
};
/** A simple 800 x 450 PNG poster: diagonal bands and a large disc in the category colour. */
export function poster(hue: number, variant: number): Buffer {
  const w = 800;
  const h = 450;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const base = hsl(hue, 0.55, 0.32);
  const band = hsl((hue + 25) % 360, 0.6, 0.42);
  const disc = hsl((hue + 180) % 360, 0.7, 0.62);
  const cx = 200 + ((variant * 97) % 400);
  const cy = 120 + ((variant * 53) % 200);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const inBand = Math.floor((x + y + variant * 40) / 70) % 3 === 0;
      const inDisc = (x - cx) ** 2 + (y - cy) ** 2 < 95 ** 2;
      const px = inDisc ? disc : inBand ? band : base;
      raw.set(px, row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- reset and seed ------------------------------------------------------------------------
const bucket = () =>
  new mongoose.mongo.GridFSBucket(mongoose.connection.db!, { bucketName: "images" });

/** Removes everything made by a previous demo seed (and nothing else). */
export async function resetDemo() {
  const users = await User.find(
    { email: new RegExp(`@${DEMO_DOMAIN.replace(/\./g, "\\.")}$`) },
    "_id",
  );
  const ids = users.map((u) => u._id);
  const notices = await Notice.find({ authorId: trusted({ $in: ids }) }, "images");
  const files = notices.flatMap((n) => n.images.map((i) => i.fileId));
  const b = bucket();
  for (const id of files) await b.delete(id).catch(() => undefined);
  await Notice.deleteMany({ authorId: trusted({ $in: ids }) });
  await RefreshToken.deleteMany({ userId: trusted({ $in: ids }) });
  await AuditLog.deleteMany({ actorId: trusted({ $in: ids }) });
  await User.deleteMany({ _id: trusted({ $in: ids }) });
  return { users: ids.length, notices: notices.length, images: files.length };
}

type Options = { notices?: number; now?: Date; reset?: boolean; bcryptCost?: number };

export async function seedDemo({
  notices = 180,
  now = new Date(),
  reset = false,
  bcryptCost = 12,
}: Options = {}) {
  if (reset) await resetDemo();
  const existing = await User.countDocuments({
    email: new RegExp(`@${DEMO_DOMAIN.replace(/\./g, "\\.")}$`),
  });
  if (existing > 0) return { skipped: true as const };

  const c: Ctx = { r: rng(2026), now };
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, bcryptCost);
  const people = [
    ...ADMINS.map((name) => ({ name, role: "admin" as const })),
    ...COMMITTEE.map((name) => ({ name, role: "committee" as const })),
  ].map((p) => ({
    ...p,
    email: `${slug(p.name)}@${DEMO_DOMAIN}`,
    passwordHash,
    active: true,
    mustChangePassword: false,
    createdAt: new Date(now.getTime() - 120 * DAY),
    updatedAt: new Date(now.getTime() - 120 * DAY),
  }));
  // One disabled committee member so the admin user list shows both states.
  people[people.length - 1]!.active = false;
  const users = await User.insertMany(people);

  for (const name of CATEGORIES) {
    if (!(await Category.exists({ name }).collation({ locale: "en", strength: 2 }))) {
      await Category.create({ name });
    }
  }
  const cats = await Category.find({ name: trusted({ $in: CATEGORIES }) });
  const catByName = new Map(cats.map((x) => [x.name, x._id]));
  const authors = users.filter((u) => u.active);
  const names = Object.keys(TEMPLATES);

  type Doc = {
    _id: Types.ObjectId;
    title: string;
    body: string;
    categoryId: Types.ObjectId;
    authorId: Types.ObjectId;
    status: string;
    pinned: boolean;
    images: { fileId: Types.ObjectId; alt: string }[];
    publishedAt: Date | undefined;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  const docs: Doc[] = [];
  const pendingImages: { noticeId: Types.ObjectId; hue: number; variant: number; alt: string }[] =
    [];
  for (let i = 0; i < notices; i++) {
    const catName = pick(c, names);
    const t = pick(c, TEMPLATES[catName]!)(c);
    const roll = c.r();
    // The mix of states a real board has.
    const state =
      roll < 0.66
        ? "live"
        : roll < 0.76
          ? "soon"
          : roll < 0.84
            ? "expired"
            : roll < 0.94
              ? "draft"
              : "archived";
    const age = c.r() * 60;
    const publishedAt = new Date(now.getTime() - age * DAY);
    const createdAt = new Date(publishedAt.getTime() - (1 + c.r() * 20) * 3_600_000);
    const _id = new Types.ObjectId();
    const published = state === "live" || state === "soon" || state === "expired";
    docs.push({
      _id,
      title: t.title.slice(0, 120),
      body: t.body,
      categoryId: catByName.get(catName)!,
      authorId: pick(c, authors)._id,
      status: state === "draft" ? "draft" : state === "archived" ? "archived" : "published",
      pinned: false,
      images: [] as { fileId: Types.ObjectId; alt: string }[],
      publishedAt: state === "draft" ? undefined : publishedAt,
      expiresAt:
        state === "soon"
          ? inDays(c, 0.2, 3)
          : state === "expired"
            ? new Date(now.getTime() - (1 + c.r() * 25) * DAY)
            : state === "live" && c.r() < 0.25
              ? inDays(c, 10, 60)
              : null,
      createdAt,
      updatedAt: new Date(createdAt.getTime() + c.r() * 3 * 3_600_000),
    });
    if (published && c.r() < 0.4) {
      const count = c.r() < 0.2 ? 2 : 1;
      for (let k = 0; k < count; k++) {
        pendingImages.push({
          noticeId: _id,
          hue: HUE[catName]!,
          variant: i * 3 + k,
          alt: `Poster for ${t.title}`.slice(0, 120),
        });
      }
    }
  }
  // Pin the three newest notices that are still on the board.
  docs
    .filter((d) => d.status === "published" && (!d.expiresAt || d.expiresAt > now))
    .sort((a, b) => b.publishedAt!.getTime() - a.publishedAt!.getTime())
    .slice(0, 3)
    .forEach((d) => (d.pinned = true));

  // Images go in GridFS exactly like real uploads (same metadata), shared posters are reused by variant.
  const cache = new Map<string, Buffer>();
  let imageCount = 0;
  for (const img of pendingImages) {
    const key = `${img.hue}-${img.variant % 6}`;
    if (!cache.has(key)) cache.set(key, poster(img.hue, img.variant % 6));
    const bytes = cache.get(key)!;
    const doc = docs.find((d) => d._id.equals(img.noticeId))!;
    const stream = bucket().openUploadStream(`${new Types.ObjectId()}.png`, {
      metadata: {
        uploaderId: String(doc.authorId),
        contentType: "image/png",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        alt: img.alt,
        noticeId: img.noticeId,
      },
    });
    await new Promise<void>((resolve, reject) => {
      stream.once("finish", () => resolve()).once("error", reject);
      stream.end(bytes);
    });
    doc.images.push({ fileId: stream.id as Types.ObjectId, alt: img.alt });
    imageCount++;
  }

  // insertMany through the collection keeps the back-dated createdAt/updatedAt values.
  await Notice.collection.insertMany(docs);
  const count = (s: string) => docs.filter((d) => d.status === s).length;
  return {
    skipped: false as const,
    admins: ADMINS.length,
    committee: COMMITTEE.length,
    categories: CATEGORIES.length,
    notices: docs.length,
    published: count("published"),
    drafts: count("draft"),
    archived: count("archived"),
    pinned: docs.filter((d) => d.pinned).length,
    images: imageCount,
  };
}

async function main() {
  const { MONGODB_URI, BCRYPT_COST } = process.env;
  if (!MONGODB_URI) throw new Error("Set MONGODB_URI");
  const reset = process.argv.includes("--reset");
  if (MONGODB_URI.startsWith("mongodb+srv:") && !process.argv.includes("--force")) {
    throw new Error(
      "This looks like a hosted database. Demo data is for local use; add --force if you really want it there.",
    );
  }
  await mongoose.connect(MONGODB_URI);
  const r = await seedDemo({ reset, bcryptCost: Number(BCRYPT_COST ?? 12) });
  if (r.skipped) {
    console.log("Demo data already exists. Run with --reset to replace it.");
  } else {
    console.log(
      `Demo data created: ${r.admins} admins, ${r.committee} committee members, ${r.categories} categories,`,
    );
    console.log(
      `${r.notices} notices (${r.published} published, ${r.drafts} drafts, ${r.archived} archived, ${r.pinned} pinned), ${r.images} images.`,
    );
    console.log(`Sign in with any email below using the password ${DEMO_PASSWORD}:`);
    console.log(`  admin:     ${slug(ADMINS[0]!)}@${DEMO_DOMAIN}`);
    console.log(`  committee: ${slug(COMMITTEE[0]!)}@${DEMO_DOMAIN}`);
  }
  await mongoose.disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
