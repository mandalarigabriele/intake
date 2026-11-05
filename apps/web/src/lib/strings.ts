/** User-facing texts (Italian), taken from docs/design. Keep every UI string here. */

export const t = {
  appName: "Intake",
  today: "Oggi",
  loading: "Caricamento…",
  retry: "Riprova",
  close: "Chiudi",

  nav: {
    label: "Navigazione",
    today: "Oggi",
    week: "Settimana",
    plan: "Piano",
    training: "Allenamenti",
    add: "Aggiungi",
    addButton: "+ Aggiungi",
    nutritionConnected: "Nutrition collegato",
  },

  signIn: {
    tagline: "Il tuo diario alimentare, con i dati reali del giorno e il tuo piano.",
    button: "Accedi con Google",
    ownerOnly: "Accesso riservato al proprietario dell'app.",
  },

  profile: {
    label: "Profilo",
    signedInAs: "Accesso come",
    signOut: "Esci",
    disconnectNutrition: "Scollega Nutrition",
    disconnectConfirm: "Scollegare Nutrition? Dovrai ricollegarlo per vedere i tuoi dati.",
    theme: "Tema",
    themeOptions: { system: "Sistema", light: "Chiaro", dark: "Scuro" },
  },

  connect: {
    step: "PASSO 2 DI 2 · SOLO LA PRIMA VOLTA",
    title: "Collega i tuoi dati Nutrition",
    body: "Intake legge in diretta gli stessi pasti, l'acqua e il peso che registri parlando con Claude. Il collegamento si fa una volta e resta attivo.",
    google: "Google",
    googleOk: "Accesso all'app verificato",
    nutrition: "Nutrition",
    nutritionPending: "nutrition-mcp.com · da collegare",
    steps: [
      "Si apre la pagina di accesso di Nutrition",
      "Autorizzi Intake a leggere e modificare i tuoi pasti",
      "Torni qui e vedi subito la giornata di oggi",
    ],
    button: "Collega Nutrition",
    footnote: "Puoi scollegarlo quando vuoi dal menu del profilo.",
  },

  notices: {
    "signin=denied": "Questo account Google non è autorizzato a usare Intake.",
    "signin=error": "Accesso non completato. Riprova.",
    "nutrition=connected": "Account Nutrition collegato.",
    "nutrition=error": "Collegamento dell'account Nutrition non riuscito. Riprova.",
  } as Record<string, string>,

  errors: {
    loadFailed: "Impossibile caricare i dati della giornata.",
    waterFailed: "Acqua non registrata. Riprova.",
  },

  weekdaysShort: ["L", "M", "M", "G", "V", "S", "D"],

  calories: {
    left: "kcal rimanenti",
    over: "kcal in eccesso",
    eaten: "Mangiate",
    goal: "Obiettivo",
    noGoal: "Nessun obiettivo",
    ofDay: (percent: string) => `${percent} della giornata`,
    overGoal: (percent: string) => `${percent} · oltre l'obiettivo`,
  },

  macros: {
    protein: "Proteine",
    carbs: "Carboidrati",
    fat: "Grassi",
    fiber: "Fibre",
    left: (value: string) => `mancano ${value}`,
    over: (value: string) => `${value} in eccesso`,
    reached: "obiettivo raggiunto",
  },

  macroChips: { protein: "P", carbs: "C", fat: "G", fiber: "Fibre" },

  water: {
    title: "Acqua",
    add: (amount: string) => `+ ${amount}`,
    addLong: (amount: string) => `Acqua + ${amount}`,
    glasses: (filled: number, total: number) => `${filled} bicchieri su ${total}`,
  },

  timeline: {
    title: "Timeline",
    logged: (count: number) => (count === 1 ? "1 registrato" : `${count} registrati`),
    now: "ADESSO",
    nowLabel: "Adesso",
    empty: "Nessun pasto registrato.",
  },

  addSheet: {
    title: "Aggiungi",
    comingSoon: "Pasti del piano, pasti recenti e ricerca alimenti arriveranno nei prossimi aggiornamenti.",
    claudeHint:
      'Per foto del piatto o descrizioni libere ("ho mangiato una pizza margherita") continua a usare Claude: registra direttamente su Nutrition.',
    waterAdded: (amount: string) => `${amount} di acqua registrati.`,
  },

  training: {
    title: "Allenamenti",
    soon: "In arrivo",
    body: "Qui compariranno gli allenamenti della settimana da Hevy, accanto a quello che mangi.",
  },

  placeholder: {
    soon: "In arrivo",
    week: "Calorie della settimana, medie e peso arriveranno in un prossimo aggiornamento.",
    plan: "Qui vedrai il piano alimentare caricato da Claude, giorno per giorno.",
  },

  mealTypes: {
    breakfast: "Colazione",
    lunch: "Pranzo",
    dinner: "Cena",
    snack: "Spuntino",
  } as Record<string, string>,
};
