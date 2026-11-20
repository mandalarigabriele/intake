import { ParseError, type Parsed } from "./common.js";

/**
 * Reads the download link out of the export_all_data answer. The archive itself is never parsed here: it is saved
 * exactly as Nutrition produced it (docs/backups.md).
 *
 *   Exported all data to a ZIP archive: 91 meals, 96 water entries, …
 *   Download (link valid for 60 minutes): https://<project>.supabase.co/storage/v1/object/sign/exports/…/nutrition-mcp-export.zip?token=…
 *
 * Only an https link to Nutrition's file storage is accepted, so the server never downloads from another address.
 */

const LINK = /https:\/\/\S+/;

export interface ExportLink {
  url: string;
  /** The first line, e.g. "Exported all data to a ZIP archive: 91 meals, …", kept for the logs. */
  summary: string;
}

export function isNutritionExportUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.hostname.endsWith(".supabase.co") && url.pathname.startsWith("/storage/v1/object/sign/") && url.pathname.endsWith(".zip");
}

export function parseExportLink(text: string): Parsed<ExportLink> {
  const url = LINK.exec(text)?.[0];
  if (!url) throw new ParseError("export_all_data answer without a download link", text);
  if (!isNutritionExportUrl(url)) throw new ParseError("export_all_data link is not Nutrition's file storage", url.split("?")[0]);
  return { value: { url, summary: text.split("\n")[0]!.trim() }, warnings: [] };
}
