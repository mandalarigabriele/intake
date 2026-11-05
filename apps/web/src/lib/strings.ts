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
  weekdaysLong: ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"],

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
    todoCount: (count: number) => `${count} da registrare`,
    plannedCount: (count: number) => `${count} dal piano`,
    todo: "DA REGISTRARE",
    planned: "DAL PIANO",
    free: "LIBERO",
    eatenAsPlanned: "Mangiato come previsto",
    other: "Altro…",
    noMacros: "Il piano non ha i valori nutrizionali di questo pasto: registralo con Altro… o da Claude.",
    logFailed: "Pasto non registrato. Riprova.",
    now: "ADESSO",
    nowLabel: "Adesso",
    empty: "Nessun pasto registrato.",
  },

  addSheet: {
    title: "Aggiungi",
    fromPlan: "DAL PIANO DI OGGI",
    log: "Registra",
    noMacros: "Senza valori nel piano",
    otherFood: "ALTRO CIBO",
    comingSoon: "Ripeti un pasto recente, pasti salvati, ricerca e codice a barre arriveranno nei prossimi aggiornamenti.",
    claudeHint:
      'Per foto del piatto o descrizioni libere ("ho mangiato una pizza margherita") continua a usare Claude: registra direttamente su Nutrition.',
    waterAdded: (amount: string) => `${amount} di acqua registrati.`,
  },

  training: {
    title: "Allenamenti",
    soon: "In arrivo",
    body: "Qui compariranno gli allenamenti della settimana da Hevy, accanto a quello che mangi.",
  },

  plan: {
    title: "Piano",
    activeFrom: (date: string) => `Attivo dal ${date}`,
    startsOn: (date: string) => `Parte dal ${date}`,
    perDay: (kcal: string | null, protein: string | null) => [kcal && `${kcal} kcal`, protein && `${protein} g prot.`].filter(Boolean).join(" · "),
    manage: "Gestisci piano",
    upload: "Carica nuovo piano",
    uploadHint: "File .json generato da Claude",
    history: "Storico versioni",
    historyHint: (count: number, since: string | null) =>
      `${count === 1 ? "1 piano" : `${count} piani`}${since ? ` · in uso dal ${since}` : ""}`,
    today: "oggi",
    free: "libero",
    proteinTag: (grams: string) => `${grams} g`,
    proteinNote: (grams: string) => `~${grams} g proteine`,
    freeBadge: "LIBERO",
    emptyTitle: "Nessun piano caricato",
    emptyBody: "Carica il file .json del piano generato nel progetto Claude Fitness: comparirà qui e nella timeline di Oggi.",
    uploaded: (date: string) => `Piano caricato: attivo dal ${date}.`,
    uploadInvalid: "Il file non è un piano valido:",
    uploadNotJson: "Il file non è un JSON valido.",
    uploadFailed: "Caricamento non riuscito. Riprova.",
    notes: "Note del piano",
    status: { active: "In uso", scheduled: "Programmato", superseded: "Precedente" } as Record<string, string>,
    uploadedOn: (date: string) => `caricato il ${date}`,
    validFrom: (date: string) => `Dal ${date}`,
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
