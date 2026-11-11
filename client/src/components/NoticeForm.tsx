import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { ApiError, api } from "../lib/api";
import { useNoticesStore, type Notice } from "../store/noticesStore";

// Mirror the server limits (MAX_IMAGE_MB, MAX_IMAGES_PER_NOTICE) for friendly early messages.
// The server enforces them regardless.
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

type Image = { id: string; alt: string; isNew: boolean };
type Fields = Record<string, string>;

/** ISO timestamp -> the value a datetime-local input expects, in the user's own time zone. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const input = "w-full rounded border border-slate-300 bg-white px-3 py-2";
const label = "block text-sm font-medium";

type Props = { initial?: Notice; onSaved: () => void };

export default function NoticeForm({ initial, onSaved }: Props) {
  const categories = useNoticesStore((s) => s.categories);
  const loadCategories = useNoticesStore((s) => s.loadCategories);
  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [categoryId, setCategoryId] = useState(initial?.category.id ?? "");
  const [status, setStatus] = useState<string>(initial?.status ?? "draft");
  const [expires, setExpires] = useState(toLocalInput(initial?.expiresAt ?? null));
  const [images, setImages] = useState<Image[]>(
    (initial?.images ?? []).map((i) => ({ ...i, isNew: false })),
  );
  const [alt, setAlt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Fields>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const field = e.target;
    const file = field.files?.[0];
    if (!file) return;
    field.value = ""; // allow choosing the same file again
    setImageError(null);
    if (!alt.trim()) return setImageError("Describe the image first (alt text).");
    if (images.length >= MAX_IMAGES)
      return setImageError(`At most ${MAX_IMAGES} images per notice.`);
    if (!IMAGE_TYPES.includes(file.type)) return setImageError("Only JPEG, PNG or WebP images.");
    if (file.size > MAX_IMAGE_BYTES) return setImageError("That image is larger than 10 MB.");

    setUploading(true);
    try {
      const form = new FormData();
      form.append("alt", alt.trim());
      form.append("file", file); // sent exactly as chosen: no resizing or compression
      const saved = await api<{ fileId: string; alt: string }>("/images", {
        method: "POST",
        body: form,
      });
      setImages((list) => [...list, { id: saved.fileId, alt: saved.alt, isNew: true }]);
      setAlt("");
    } catch (err) {
      setImageError(
        err instanceof ApiError && err.status === 413
          ? "That image is larger than 10 MB."
          : err instanceof ApiError && err.fields?.file
            ? err.fields.file
            : "Could not upload the image. Please try again.",
      );
    } finally {
      setUploading(false);
    }
  };

  const remove = async (image: Image) => {
    setImageError(null);
    // An image uploaded in this session belongs to no notice yet, so delete it right away.
    // An existing one is only dropped from the list; saving the notice deletes its file.
    if (image.isNew) {
      try {
        await api(`/images/${image.id}`, { method: "DELETE" });
      } catch {
        return setImageError("Could not remove the image. Please try again.");
      }
    }
    setImages((list) => list.filter((i) => i.id !== image.id));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);
    const payload = {
      title,
      body,
      categoryId,
      status,
      expiresAt: expires ? new Date(expires).toISOString() : null,
      images: images.map((i) => ({ fileId: i.id, alt: i.alt })),
    };
    try {
      if (initial) await api(`/notices/${initial.id}`, { method: "PATCH", body: payload });
      else await api("/notices", { method: "POST", body: payload });
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.fields) setErrors(err.fields);
      else
        setFormError(err instanceof ApiError ? err.message : "Could not save. Please try again.");
      setSaving(false);
    }
  };

  const fieldError = (name: string) =>
    errors[name] && (
      <p id={`${name}-error`} className="mt-1 text-sm text-red-700">
        {errors[name]}
      </p>
    );
  const describedBy = (name: string) => (errors[name] ? `${name}-error` : undefined);

  return (
    <form onSubmit={submit} className="space-y-5" noValidate={false}>
      <div>
        <label htmlFor="title" className={label}>
          Title
        </label>
        <input
          id="title"
          required
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={!!errors.title}
          aria-describedby={describedBy("title")}
          className={input}
        />
        {fieldError("title")}
      </div>

      <div>
        <label htmlFor="body" className={label}>
          Text
        </label>
        <textarea
          id="body"
          required
          rows={8}
          maxLength={5000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-invalid={!!errors.body}
          aria-describedby={describedBy("body")}
          className={input}
        />
        {fieldError("body")}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="categoryId" className={label}>
            Category
          </label>
          <select
            id="categoryId"
            required
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            aria-invalid={!!errors.categoryId}
            aria-describedby={describedBy("categoryId")}
            className={input}
          >
            <option value="">Choose a category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {fieldError("categoryId")}
        </div>
        <div>
          <label htmlFor="status" className={label}>
            Status
          </label>
          <select
            id="status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={input}
          >
            <option value="draft">Draft (only you can see it)</option>
            <option value="published">Published (everyone can see it)</option>
            {initial && <option value="archived">Archived (hidden, kept)</option>}
          </select>
          {fieldError("status")}
        </div>
      </div>

      <div>
        <label htmlFor="expiresAt" className={label}>
          Hide automatically after (optional)
        </label>
        <input
          id="expiresAt"
          type="datetime-local"
          value={expires}
          onChange={(e) => setExpires(e.target.value)}
          aria-invalid={!!errors.expiresAt}
          aria-describedby={describedBy("expiresAt")}
          className={input}
        />
        {fieldError("expiresAt")}
      </div>

      <fieldset className="rounded border border-slate-200 bg-white p-4">
        <legend className="px-1 text-sm font-medium">
          Images ({images.length} of {MAX_IMAGES})
        </legend>
        <p className="mb-3 text-sm text-slate-700">
          Images are stored exactly as you upload them, including any data the camera saved, such as
          the location where a photo was taken.
        </p>
        {images.length > 0 && (
          <ul className="mb-4 grid gap-3 sm:grid-cols-2">
            {images.map((image) => (
              <li key={image.id} className="rounded border border-slate-200 p-2">
                <img
                  src={`/api/images/${image.id}`}
                  alt={image.alt}
                  className="mb-2 h-32 w-full object-cover"
                />
                <p className="mb-2 text-sm">{image.alt}</p>
                <button
                  type="button"
                  onClick={() => void remove(image)}
                  aria-label={`Remove image: ${image.alt}`}
                  className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-2">
          <label htmlFor="alt" className={label}>
            Image description (alt text)
          </label>
          <input
            id="alt"
            maxLength={120}
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            className={input}
          />
          <label htmlFor="file" className={label}>
            Choose image
          </label>
          <input
            id="file"
            type="file"
            accept={IMAGE_TYPES.join(",")}
            disabled={uploading}
            onChange={(e) => void upload(e)}
            className="block text-sm"
          />
          {uploading && <p role="status">Uploading…</p>}
          {imageError && (
            <p role="alert" className="text-sm text-red-700">
              {imageError}
            </p>
          )}
          {fieldError("images")}
        </div>
      </fieldset>

      {formError && (
        <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-800">
          {formError}
        </p>
      )}
      <button
        type="submit"
        disabled={saving || uploading}
        className="rounded bg-slate-900 px-4 py-2 text-white hover:bg-slate-700 disabled:opacity-60"
      >
        {saving ? "Saving…" : initial ? "Save changes" : "Create notice"}
      </button>
    </form>
  );
}
