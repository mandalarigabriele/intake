# Shopping list and PDF of the plan

Piano › ⋯ › "Lista della spesa" and "Stampa o salva PDF". Both work on the plan Piano shows (the one in effect today, or the next scheduled one), need no AI and no optional part, and store nothing.

## The list

`shoppingList` (`packages/shared/src/shoppingList.ts`) adds up the foods of every planned meal of the seven days, by name and unit:

- names are compared without case and accents; `kg` and `l` become `g` and `ml` before adding and are shown back as kg / l from 1000;
- a food with no amount and a leading number ("1 frutto", "2 uova") becomes a count in pieces; a food with no amount at all ("Insalata") is one line without a total;
- the same food in different units stays on separate lines ("Pane 140 g" and "Pane 10 fette");
- free meals add nothing;
- sections (Frutta e verdura, Carne e pesce, Latticini e uova, Pane e forno, Dispensa, Altro) come from a keyword table (Italian, English, Dutch); a food that matches nothing goes to Altro.

Plans written as free text (a whole dish in one food line) give lines like the dish itself; plans generated in the app, with one food per line, give the cleanest list.

## Apple Reminders

"Copia lista" puts one item per line on the clipboard, with no headings. Pasted into Reminders on iPhone, iPad or Mac, every line becomes a reminder of its own. There is no direct link to Reminders: the web has no API for it. An iOS Shortcut that pulls the list from an endpoint is not built.

## PDF

`/piano/stampa` makes a compact A4 PDF in the browser (`lib/planPdf.ts`, jsPDF loaded only on that page): page 1 has the seven days in three columns (time, meal, kcal, and the foods with their doses on running lines, e.g. "Yogurt greco 150 g · Muesli 40 g · Banana 1"), page 2 the shopping list in sections with a box before each item. It is made when the page opens, so "Salva PDF" only has to hand it over: on phones and tablets it opens the system share sheet (Save to Files, Print, Mail, AirDrop), on desktop browsers it downloads `piano-<date>.pdf`. The installed iPhone app has no print window (`window.print()` does nothing there), which is why the PDF is made by the app and the "Stampa" button is hidden in the installed app.

The page also shows the week and the list as a sheet, and "Stampa" (desktop browsers) prints that sheet with `@media print` styles (three columns, small type, light colors, app chrome hidden; on screen only `.shell-main` scrolls, so the print styles let the page flow). The standard PDF fonts only cover Western characters: other characters become a space.
