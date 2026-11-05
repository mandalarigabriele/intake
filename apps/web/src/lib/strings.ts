/** User-facing texts (Italian). Keep every UI string here so wording is easy to review. */

export const t = {
  appName: "Intake",
  today: "Oggi",
  loading: "Caricamento…",
  retry: "Riprova",

  signIn: {
    title: "Benvenuto",
    subtitle: "Accedi con il tuo account Google per continuare.",
    button: "Accedi con Google",
    signOut: "Esci",
    signedInAs: "Accesso come",
  },

  notices: {
    "signin=denied": "Questo account Google non è autorizzato a usare Intake.",
    "signin=error": "Accesso non completato. Riprova.",
    "nutrition=connected": "Account Nutrition collegato.",
    "nutrition=error": "Collegamento dell'account Nutrition non riuscito. Riprova.",
  } as Record<string, string>,

  errors: {
    notConnectedTitle: "Collega il tuo account Nutrition",
    notConnectedBody: "Intake legge pasti, obiettivi e acqua dal tuo account Nutrition.",
    connect: "Collega account",
    loadFailed: "Impossibile caricare i dati della giornata.",
    waterFailed: "Acqua non registrata. Riprova.",
  },

  weekdaysShort: ["L", "M", "M", "G", "V", "S", "D"],

  calories: {
    left: "kcal rimanenti",
    over: "kcal in eccesso",
    eaten: "Mangiate",
    goal: "Obiettivo",
    noGoal: "Nessun obiettivo impostato",
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
    glasses: (filled: number, total: number) => `${filled} bicchieri su ${total}`,
  },

  timeline: {
    title: "Timeline",
    logged: (count: number) => (count === 1 ? "1 registrato" : `${count} registrati`),
    now: "Adesso",
    empty: "Nessun pasto registrato.",
  },

  mealTypes: {
    breakfast: "Colazione",
    lunch: "Pranzo",
    dinner: "Cena",
    snack: "Spuntino",
  } as Record<string, string>,
};
