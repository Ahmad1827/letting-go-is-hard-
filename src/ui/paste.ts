import type { Picture } from '../agents/types';

/** Pictures bigger than this on their long side are scaled down before sending. */
const MAX_SIDE = 1568;

/** Read an image file into a base64 picture, scaled down if it's huge. */
async function load(file: File): Promise<Picture & { url: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const mediaType = file.type === 'image/png' && scale === 1 && file.size < 3_000_000 ? 'image/png' : 'image/jpeg';
  const url = canvas.toDataURL(mediaType, 0.9);
  return { mediaType, data: url.slice(url.indexOf(',') + 1), url };
}

/**
 * Lets the user paste (Ctrl+V) or drop pictures onto a text field. Shows them as
 * thumbnails in `strip`; `take()` hands them over and clears the strip.
 */
export function acceptPictures(field: HTMLElement) {
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

  const add = async (files: File[]) => {
    for (const f of files.filter((f) => f.type.startsWith('image/'))) {
      try {
        pictures.push(await load(f));
      } catch {
        // not a picture the browser can read; skip it
      }
    }
    render();
  };

  field.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault();
      void add(files);
    }
  });
  field.addEventListener('dragover', (e) => e.preventDefault());
  field.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) {
      e.preventDefault();
      void add(files);
    }
  });

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
