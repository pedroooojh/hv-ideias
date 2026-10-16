import { ApiError } from './errors';
import type { PreparedImage } from './api';

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const AVATAR_SIZE = 256;

async function decode(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      // Alguns navegadores não decodificam certos formatos aqui; tenta com <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Quadrado escolhido no recorte, em pixels da imagem original. */
export interface CropArea {
  x: number;
  y: number;
  size: number;
}

/** Garante que o arquivo é uma imagem aceitável antes de abrir o recorte. */
export function checkAvatarFile(file: File) {
  if (!file.type.startsWith('image/')) {
    throw new ApiError('Escolha um arquivo de imagem (JPG, PNG ou WebP).', 'validation');
  }
  if (file.size > MAX_INPUT_BYTES) throw new ApiError('A imagem deve ter no máximo 10 MB.', 'validation');
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Recorta o quadrado escolhido (ou o centro, sem recorte) e reduz para 256×256,
 * em WebP (ou JPEG nos navegadores que não geram WebP). Fica com poucos KB.
 */
export async function prepareAvatar(file: File, crop?: CropArea): Promise<PreparedImage> {
  checkAvatarFile(file);

  let image;
  try {
    image = await decode(file);
  } catch {
    throw new ApiError('Não foi possível ler esta imagem. Tente outro arquivo.', 'validation');
  }
  const side = crop ? Math.min(crop.size, image.width, image.height) : Math.min(image.width, image.height);
  const sx = crop ? Math.min(Math.max(0, crop.x), image.width - side) : (image.width - side) / 2;
  const sy = crop ? Math.min(Math.max(0, crop.y), image.height - side) : (image.height - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx || side === 0) throw new ApiError('Não foi possível ler esta imagem. Tente outro arquivo.', 'validation');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  if ('close' in image && typeof image.close === 'function') image.close();

  let blob = await toBlob(canvas, 'image/webp', 0.86);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', 0.88);
  if (!blob) throw new ApiError('Não foi possível processar a imagem.', 'unknown');
  return { data: await blob.arrayBuffer(), type: blob.type, ext: blob.type === 'image/webp' ? 'webp' : 'jpg' };
}
