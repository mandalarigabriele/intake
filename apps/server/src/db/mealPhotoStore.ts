import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MEAL_PHOTOS_MAX } from "@intake/shared";

const MEAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Photo id: creation time in base 36 (sortable) plus a random part, e.g. "0mgt4k2a1f3c9b". */
const PHOTO_ID = /^[0-9a-z]{10,24}$/;

/** Largest photo kept: the app sends a JPEG resized to 1568 px, usually 200–400 KB. */
export const MEAL_PHOTO_MAX_BYTES = 3 * 1024 * 1024;

/** A meal already has the most photos allowed. */
export class TooManyPhotosError extends Error {
  constructor() {
    super(`A meal keeps at most ${MEAL_PHOTOS_MAX} photos`);
    this.name = "TooManyPhotosError";
  }
}

function photoId(at = Date.now()): string {
  return `${at.toString(36).padStart(9, "0")}${randomBytes(3).toString("hex")}`;
}

/**
 * Photos of meals, up to MEAL_PHOTOS_MAX JPEGs per Nutrition meal id in `<DATA_DIR>/meal-photos/<meal id>/<photo id>.jpg`,
 * oldest first. Nutrition stores no images, so this is local data like the plans; it is in the data volume, so deploy.sh
 * backs it up. The single `<meal id>.jpg` of earlier versions is moved into the meal's folder on start.
 */
export class MealPhotoStore {
  constructor(private readonly dir: string) {
    this.migrateSinglePhotos();
  }

  static isMealId(id: string): boolean {
    return MEAL_ID.test(id);
  }

  static isPhotoId(id: string): boolean {
    return PHOTO_ID.test(id);
  }

  /** A JPEG starts with FF D8 FF; anything else is refused. */
  static isJpeg(bytes: Buffer): boolean {
    return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  /** Adds a photo to the meal; returns its id. */
  add(mealId: string, jpeg: Buffer): string {
    if (!MealPhotoStore.isMealId(mealId)) throw new Error("invalid meal id");
    if (!MealPhotoStore.isJpeg(jpeg) || jpeg.length > MEAL_PHOTO_MAX_BYTES) throw new Error("invalid photo");
    const existing = this.photos(mealId);
    if (existing.length >= MEAL_PHOTOS_MAX) throw new TooManyPhotosError();
    const folder = this.folder(mealId);
    mkdirSync(folder, { recursive: true });
    // Always after the last photo, even when two arrive in the same millisecond, so the order is the order they were added
    const last = existing.at(-1);
    const after = last ? parseInt(last.slice(0, 9), 36) + 1 : 0;
    let id = photoId(Math.max(Date.now(), after));
    while (existsSync(join(folder, `${id}.jpg`))) id = photoId(Math.max(Date.now(), after));
    writeFileSync(join(folder, `${id}.jpg`), jpeg);
    return id;
  }

  /** Photo ids of the meal, oldest first. */
  photos(mealId: string): string[] {
    if (!MealPhotoStore.isMealId(mealId)) return [];
    try {
      return readdirSync(this.folder(mealId))
        .filter((name) => name.endsWith(".jpg") && MealPhotoStore.isPhotoId(name.slice(0, -4)))
        .map((name) => name.slice(0, -4))
        .sort();
    } catch {
      return [];
    }
  }

  get(mealId: string, id: string): Buffer | null {
    if (!MealPhotoStore.isMealId(mealId) || !MealPhotoStore.isPhotoId(id)) return null;
    try {
      return readFileSync(join(this.folder(mealId), `${id}.jpg`));
    } catch {
      return null;
    }
  }

  /** The first photo of the meal (thumbnails and the old single-photo URL). */
  first(mealId: string): Buffer | null {
    const id = this.photos(mealId)[0];
    return id ? this.get(mealId, id) : null;
  }

  /** Removes one photo; false when the meal has no such photo. */
  remove(mealId: string, id: string): boolean {
    if (!MealPhotoStore.isMealId(mealId) || !MealPhotoStore.isPhotoId(id)) return false;
    const path = join(this.folder(mealId), `${id}.jpg`);
    if (!existsSync(path)) return false;
    rmSync(path, { force: true });
    if (this.photos(mealId).length === 0) rmSync(this.folder(mealId), { recursive: true, force: true });
    return true;
  }

  /** Removes every photo of the meal (the meal was deleted). */
  delete(mealId: string): void {
    if (MealPhotoStore.isMealId(mealId)) rmSync(this.folder(mealId), { recursive: true, force: true });
  }

  /** Meal id → photo ids, for the meals that have photos. */
  list(): Record<string, string[]> {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return {};
    }
    const result: Record<string, string[]> = {};
    for (const name of names) {
      if (!MealPhotoStore.isMealId(name)) continue;
      const ids = this.photos(name);
      if (ids.length > 0) result[name.toLowerCase()] = ids;
    }
    return result;
  }

  private folder(mealId: string): string {
    return join(this.dir, mealId.toLowerCase());
  }

  /** `<meal id>.jpg` (one photo per meal, before several were allowed) → `<meal id>/<photo id>.jpg`, keeping its date. */
  private migrateSinglePhotos(): void {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return;
    }
    for (const name of names) {
      const mealId = name.endsWith(".jpg") ? name.slice(0, -4) : "";
      if (!MealPhotoStore.isMealId(mealId)) continue;
      const from = join(this.dir, name);
      const folder = this.folder(mealId);
      mkdirSync(folder, { recursive: true });
      renameSync(from, join(folder, `${photoId(Math.floor(statSync(from).mtimeMs))}.jpg`));
    }
  }
}
