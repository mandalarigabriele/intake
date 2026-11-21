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

`/piano/stampa` shows the week (every day with time, kcal, dish and foods), then the shopping list on its own page, with a box to tick before each item, and the plan notes. "Stampa / Salva PDF" opens the system print window; "Salva come PDF" makes the file. The print styles (`@media print` in `styles/base.css`) hide the app, force light colors and let the page flow, because on screen only `.shell-main` scrolls.
