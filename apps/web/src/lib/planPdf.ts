import { SHOPPING_CATEGORIES, WEEKDAYS, foodLine, isFixedMeal, planAverages, shoppingLine, shoppingList, type MealPlan } from "@intake/shared";
import { formatKcal, formatMediumDate } from "./format";
import { t } from "./strings";

/** The standard PDF fonts only cover Western characters: anything else becomes a plain equivalent or a space. */
const latin = (text: string) =>
  text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^ -ÿ]/g, " ");

const MARGIN = 12;
const GAP = 5;
const PAGE = { width: 210, height: 297 };

/**
 * The week's plan and the shopping list as a compact A4 PDF (jsPDF, loaded only when asked): the seven days in three
 * columns on the first page, the list with a box before each item on the next. Made in the browser, so it works in the
 * installed iPhone app, where the system print window is not available. docs/shopping-list.md
 */
export async function makePlanPdf(plan: MealPlan): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const s = t.shopping;
  doc.setProperties({ title: s.printTitle });

  // ── Header ──
  const averages = planAverages(plan);
  doc.setFont("helvetica", "bold").setFontSize(16);
  doc.text(latin(s.printTitle), MARGIN, MARGIN + 4);
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(90);
  const subtitle = [s.validFrom(formatMediumDate(plan.validFrom)), averages ? s.goalsLine(averages.kcal !== null ? formatKcal(Math.round(averages.kcal / 50) * 50) : null, averages.protein !== null ? formatKcal(Math.round(averages.protein / 5) * 5) : null) : ""].filter(Boolean).join(" · ");
  doc.text(latin(subtitle), MARGIN, MARGIN + 9);
  doc.setTextColor(0);

  // ── Days: three columns, rows of days; a day is never split ──
  const columns = 3;
  const colWidth = (PAGE.width - MARGIN * 2 - GAP * (columns - 1)) / columns;
  const line = 3.3;
  const bottom = PAGE.height - MARGIN;

  function dayBlock(weekday: (typeof WEEKDAYS)[number], index: number) {
    const rows: Array<{ text: string[]; bold: boolean; gray?: boolean }> = [];
    for (const meal of plan.days[weekday].meals) {
      const head = [meal.time, meal.title, isFixedMeal(meal) && meal.macros ? `${formatKcal(meal.macros.kcal)} kcal` : ""].filter(Boolean).join("  ");
      doc.setFont("helvetica", "bold").setFontSize(7.5);
      rows.push({ text: doc.splitTextToSize(latin(head), colWidth), bold: true });
      doc.setFont("helvetica", "normal").setFontSize(7.5);
      // The foods with their doses, one running line: the dish text alone would hide the amounts
      const body = isFixedMeal(meal) ? meal.foods.map(foodLine).join(" · ") : s.free;
      rows.push({ text: doc.splitTextToSize(latin(body), colWidth), bold: false });
    }
    const height = 6 + rows.reduce((sum, r) => sum + r.text.length * line + (r.bold ? 0 : 1.2), 0);
    return { name: t.weekdaysLong[index]!, rows, height };
  }

  const blocks = WEEKDAYS.map(dayBlock);
  let y = MARGIN + 15;
  for (let start = 0; start < blocks.length; start += columns) {
    const row = blocks.slice(start, start + columns);
    const rowHeight = Math.max(...row.map((b) => b.height));
    if (y + rowHeight > bottom) {
      doc.addPage();
      y = MARGIN;
    }
    row.forEach((block, c) => {
      const x = MARGIN + c * (colWidth + GAP);
      doc.setFont("helvetica", "bold").setFontSize(9.5);
      doc.text(latin(block.name), x, y + 3);
      doc.setLineWidth(0.4).line(x, y + 4.4, x + colWidth, y + 4.4);
      let yy = y + 8.2;
      for (const r of block.rows) {
        doc.setFont("helvetica", r.bold ? "bold" : "normal").setFontSize(7.5);
        doc.text(r.text, x, yy);
        yy += r.text.length * line + (r.bold ? 0 : 1.2);
      }
    });
    y += rowHeight + 4;
  }

  // ── Shopping list: its own page, two columns, a box before each item ──
  doc.addPage();
  doc.setFont("helvetica", "bold").setFontSize(14);
  doc.text(latin(s.title), MARGIN, MARGIN + 4);
  doc.setLineWidth(0.5).line(MARGIN, MARGIN + 6.5, PAGE.width - MARGIN, MARGIN + 6.5);
  const items = shoppingList(plan);
  const listWidth = (PAGE.width - MARGIN * 2 - 8) / 2;
  const top = MARGIN + 13;
  let column = 0;
  let ly = top;
  const nextColumn = () => {
    if (column === 0) {
      column = 1;
    } else {
      doc.addPage();
      column = 0;
    }
    ly = column === 0 && doc.getNumberOfPages() > 1 ? MARGIN : top;
  };
  const colX = () => MARGIN + column * (listWidth + 8);
  for (const category of SHOPPING_CATEGORIES) {
    const inCategory = items.filter((item) => item.category === category);
    if (inCategory.length === 0) continue;
    if (ly + 14 > bottom) nextColumn();
    doc.setFont("helvetica", "bold").setFontSize(9.5);
    doc.text(latin(s.categories[category]!), colX(), ly + 3);
    ly += 6.5;
    for (const item of inCategory) {
      doc.setFont("helvetica", "normal").setFontSize(9);
      const lines: string[] = doc.splitTextToSize(latin(shoppingLine(item)), listWidth - 6);
      if (ly + lines.length * 4 > bottom) nextColumn();
      doc.setLineWidth(0.25).rect(colX(), ly - 0.2, 2.8, 2.8);
      doc.text(lines, colX() + 5, ly + 2);
      ly += lines.length * 4 + 0.8;
    }
    ly += 3;
  }

  return doc.output("blob");
}

/** File name of the PDF, e.g. piano-2026-11-23.pdf. */
export const planPdfName = (plan: MealPlan) => `${t.shopping.pdfName}-${plan.validFrom}.pdf`;
