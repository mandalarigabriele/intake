import { describe, expect, it } from "vitest";
import { isNutritionExportUrl, parseExportLink } from "../../src/parsers/exportLink.js";
import { fixture } from "./fixtures.js";

describe("parseExportLink", () => {
  it("reads the download link of a real export_all_data answer", () => {
    const { value, warnings } = parseExportLink(fixture("export-all-data.txt"));
    expect(value.url).toMatch(/^https:\/\/exampleproject\.supabase\.co\/storage\/v1\/object\/sign\/exports\/.+\/nutrition-mcp-export\.zip\?token=/);
    expect(value.summary).toMatch(/^Exported all data to a ZIP archive: 91 meals/);
    expect(warnings).toEqual([]);
  });

  it("refuses an answer without a link, or a link outside Nutrition's file storage", () => {
    expect(() => parseExportLink("Export failed, try again later.")).toThrow(/without a download link/);
    expect(() => parseExportLink("Download: https://evil.example/storage/v1/object/sign/x.zip")).toThrow(/not Nutrition's file storage/);
    expect(isNutritionExportUrl("http://p.supabase.co/storage/v1/object/sign/a.zip")).toBe(false);
    expect(isNutritionExportUrl("https://p.supabase.co/storage/v1/object/public/a.zip")).toBe(false);
    expect(isNutritionExportUrl("https://p.supabase.co.evil.example/storage/v1/object/sign/a.zip")).toBe(false);
  });
});
