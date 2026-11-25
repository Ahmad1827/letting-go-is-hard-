import type { Picture } from '../agents/types';

/** Pictures bigger than this on their long side are scaled down before sending. */
const MAX_SIDE = 1568;

/** What the preload script exposes for pictures (see electron/preload.cjs). */
interface PictureBridge {
  clipboard(): Promise<Uint8Array | null>;
  fetch(url: string): Promise<{ type: string; bytes: Uint8Array } | null>;
}
const bridge = () => (window as { office?: { pictures?: PictureBridge } }).office?.pictures;

/**
 * The panels a picture can be dropped anywhere on, widest first: dropping on a
 * terminal's log, the inspector or a popup goes to the message box inside it.
 */
const ZONES = ['.term-win', '#inspect', '.modal', '#pitch', 'form'];

/** Read an image file into a base64 picture, scaled down if it's huge. */
async function load(file: Blob): Promise<Picture & { url: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const mediaType = file.type === 'image/png' && scale === 1 && file.size < 3_000_000 ? 'image/png' : 'image/jpeg';
  const url = canvas.toDataURL(mediaType, 0.9);
  return { mediaType, data: url.slice(url.indexOf(',') + 1), url };
}

const isImage = (f: File) => f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name);

/** Every image file on a clipboard or in a drop: items catch screenshots that `files` can miss. */
function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const out = [...data.files].filter(isImage);
  for (const item of data.items ?? []) {
    if (item.kind !== 'file') continue;
    const f = item.getAsFile();
    if (f && isImage(f) && !out.some((o) => o.name === f.name && o.size === f.size)) out.push(f);
  }
  return out;
}

/** An image dragged from a web page comes as a link (or the page's HTML), not a file. */
function droppedLink(data: DataTransfer): string | null {
  const html = data.getData('text/html');
  const src = html && new DOMParser().parseFromString(html, 'text/html').querySelector('img')?.getAttribute('src');
  const uri = data.getData('text/uri-list').split('\n').find((l) => l && !l.startsWith('#'))?.trim();
  return src || uri || null;
}

async function fromLink(url: string): Promise<Blob | null> {
  if (url.startsWith('data:image/') || url.startsWith('blob:')) {
    return fetch(url).then((r) => r.blob()).catch(() => null);
  }
  const got = await bridge()?.fetch(url).catch(() => null);
  return got ? new Blob([got.bytes as BlobPart], { type: got.type }) : null;
}

/** The screenshot on the system clipboard, read by the app when the page can't see it. */
async function fromClipboard(): Promise<Blob | null> {
  const png = await bridge()?.clipboard().catch(() => null);
  return png ? new Blob([png as BlobPart], { type: 'image/png' }) : null;
}

interface Field {
  field: HTMLElement;
  add(files: Blob[]): Promise<void>;
}
const fields = new Set<Field>();
/** The message box last typed in, which a Ctrl+V outside any text box goes to. */
let active: Field | null = null;

const shown = (f: Field) => f.field.isConnected && f.field.getClientRects().length > 0;
const editable = (t: EventTarget | null) =>
  t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');

/** The message box a drop or paste at `target` belongs to, if any. */
function fieldFor(target: EventTarget | null): Field | null {
  // closed terminals and rebuilt panels are gone for good
  for (const f of fields) if (!f.field.isConnected) fields.delete(f);
  if (active && !active.field.isConnected) active = null;
  if (!(target instanceof Node)) return null;
  const live = [...fields].filter(shown);
  const own = live.find((f) => f.field === target || f.field.contains(target));
  if (own) return own;
  for (const sel of ZONES) {
    const zone = target instanceof Element ? target.closest(sel) : target.parentElement?.closest(sel);
    const inside = zone && live.filter((f) => zone.contains(f.field));
    if (inside?.length) return inside.includes(active!) ? active : inside[inside.length - 1];
  }
  return null;
}

let wired = false;
/** One listener for the whole page, so a picture lands wherever it makes sense. */
function wire() {
  if (wired) return;
  wired = true;
  let pending: number | undefined;

  document.addEventListener('paste', (e) => {
    clearTimeout(pending);
    // a box that doesn't take pictures (a settings field, say) keeps its normal paste
    const f = fieldFor(e.target) ?? (!editable(e.target) && active && shown(active) ? active : null);
    if (!f) return;
    const images = imageFiles(e.clipboardData);
    if (images.length) {
      e.preventDefault();
      void f.add(images);
    } else if (!e.clipboardData?.types.includes('text/plain')) {
      // nothing the page can read (a screenshot tool, a picture copied from another app): ask the app
      void fromClipboard().then((b) => b && f.add([b]));
    }
  });

  // Ctrl+V with the office (not a text box) focused may never fire a paste event
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'v' || editable(e.target)) return;
    const f = active && shown(active) ? active : [...fields].find(shown);
    if (!f) return;
    clearTimeout(pending);
    pending = window.setTimeout(() => void fromClipboard().then((b) => b && f.add([b])), 60);
  });

  let lit: Element | null = null;
  const light = (zone: Element | null) => {
    if (zone === lit) return;
    lit?.classList.remove('drop-here');
    zone?.classList.add('drop-here');
    lit = zone;
  };
  const carriesPicture = (d: DataTransfer | null) => !!d && ['Files', 'text/uri-list', 'text/html'].some((t) => d.types.includes(t));

  document.addEventListener('dragover', (e) => {
    if (!carriesPicture(e.dataTransfer)) return;
    // never let a dropped file open in the window
    e.preventDefault();
    const f = fieldFor(e.target);
    e.dataTransfer!.dropEffect = f ? 'copy' : 'none';
    light(f ? (ZONES.map((s) => f.field.closest(s)).find((z) => z && z.contains(e.target as Node)) ?? f.field) : null);
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) light(null);
  });
  document.addEventListener('drop', (e) => {
    light(null);
    if (!carriesPicture(e.dataTransfer)) return;
    e.preventDefault();
    const f = fieldFor(e.target);
    if (!f) return;
    const images = imageFiles(e.dataTransfer);
    if (images.length) return void f.add(images);
    const link = droppedLink(e.dataTransfer!);
    if (link) void fromLink(link).then((b) => b && f.add([b]));
  });
}

/**
 * Lets the user paste (Ctrl+V) or drop pictures for a text field: a screenshot,
 * a copied image, image files, or a picture dragged from a browser. Shows them
 * as thumbnails in `strip`; `take()` hands them over and clears the strip.
 */
export function acceptPictures(field: HTMLElement) {
  wire();
  const strip = document.createElement('div');
  strip.className = 'pictures';
  let pictures: (Picture & { url: string })[] = [];

  const render = () => {
    strip.replaceChildren(
      ...pictures.map((p, i) => {
        const box = document.createElement('span');
        box.className = 'thumb';
        const img = document.createElement('img');
        img.src = p.url;
        const x = document.createElement('button');
        x.type = 'button';
        x.textContent = '×';
        x.title = 'Remove';
        x.onclick = () => {
          pictures.splice(i, 1);
          render();
        };
        box.append(img, x);
        return box;
      }),
    );
  };

  const entry: Field = {
    field,
    async add(files) {
      for (const f of files) {
        try {
          pictures.push(await load(f));
        } catch {
          // not a picture the browser can read; skip it
        }
      }
      render();
      active = entry;
      field.focus();
    },
  };
  fields.add(entry);
  field.addEventListener('focus', () => (active = entry));

  return {
    strip,
    take(): Picture[] {
      const out = pictures.map(({ mediaType, data }) => ({ mediaType, data }));
      pictures = [];
      render();
      return out;
    },
    get count() {
      return pictures.length;
    },
  };
}
