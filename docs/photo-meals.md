# Pasti da foto (meals from a photo or a description)

An optional part (`photoMeals`, see [features.md](features.md)), **off by default** on every installation, new or
existing. It also needs `ANTHROPIC_API_KEY` in the server's `.env`. While it is off, or without the key, the add sheet
keeps "Chiedi a Claude" as before.

## How it works

1. The add sheet shows "Foto del piatto" and "Descrivi a parole" (`/pasto/nuovo`, `/pasto/nuovo/testo`).
2. Photos from the camera or the library, **up to 6** (e.g. one per course), are resized **in the browser** (longest
   edge 1568 px, JPEG quality 0.85) and shown in a carousel with a × on each, an "Aggiungi foto" tile and an optional
   note. Nothing is sent until "Analizza", which sends all of them in one request; the prompt asks Claude to list each
   food once even when it appears in more than one photo. Redrawing the photo on a
   canvas also drops its EXIF data (GPS position, camera, date): neither Anthropic nor the server receives it.
3. `POST /api/meals/recognize` sends the photos (`images`, 1–6) and/or the text to the Claude API (`services/mealRecognition.ts`,
   official SDK `@anthropic-ai/sdk`). The answer is a **structured output** (`output_config.format`, a JSON schema
   with `additionalProperties: false` at every level), so it always has the expected shape: foods, estimated grams
   eaten, nutrition per 100 g (kcal, macros, fiber, sugar, added sugar), and likely hidden fats such as cooking oil
   marked "not visible". The ranges (grams, 1–20 foods) are checked after with zod. Food names follow the
   installation language.
4. The confirmation screen lets the user change the type, time and grams, remove foods, add a missed one in words
   ("+ Aggiungi alimento", recognized the same way) and also save the meal as a favorite.
   The same "+ Aggiungi alimento" in **Modifica pasto** (an already logged meal) asks "Cosa hai aggiunto?": the
   foods Claude finds become rows with their grams and values, scaled like the others, and are saved with "Salva";
   "Inserisci a mano" keeps the typed values of before.
5. Only "Registra pasto" writes to Nutrition (`POST /api/meals` → `log_meal`, with an idempotency key). Fiber, sugar
   and added sugar are sent all-or-none across items, as Nutrition requires.

## Model and cost

- The model is chosen in **Impostazioni › Funzioni**, under Pasti da foto: **Haiku 5.5 (default)** or Sonnet 5.5
  (settings key `recognition_model`, `db/recognitionModelStore.ts`). `RECOGNITION_MODEL` in `.env` sets the starting
  model and, if it names another one, adds it to the choice. The change applies to the next request.
- One request per "Analizza" or "+ Aggiungi alimento" (new or edited meal); nothing runs in the background. The SDK retries 429, 529 and
  connection errors twice by itself; each attempt times out after 60 s.
- Thinking is on by default on the 5.5 models and cannot be turned off on Sonnet 5.5; its tokens are billed as output
  and count against `max_tokens`. The request asks for **`effort: "low"`** (portion estimation needs little
  reasoning) and allows `max_tokens: 16000`, so an answer is not cut by the thinking; only the tokens generated are
  paid. An answer that still stops at `max_tokens` is logged and shown as unreadable.
- Every request logs its usage (model, stop reason, input, output and thinking tokens), never the photo or the text,
  so the real cost can be read in the server log or in the Anthropic Console.
- **Measured cost** (November 2026, list prices Haiku 5.5 $0.10 / $0.50 and Sonnet 5.5 $2 / $10 per million input /
  output tokens; three public food photos at 1568 px and two descriptions, `effort: "low"`, no thinking tokens were
  generated):

  | | Input tokens | Output tokens | Cost | Time |
  |---|---|---|---|---|
  | Haiku 5.5, photo | 4,000–4,800 | 390–960 | **$0.0006–0.0010** | 4–7 s |
  | Haiku 5.5, description | about 1,200 | about 300 | $0.0003 | 2 s |
  | Sonnet 5.5, photo | 4,000–4,800 | 330–610 | **$0.013–0.016** | 4–6 s |
  | Sonnet 5.5, description | about 1,200 | 220–400 | $0.005–0.006 | 2–4 s |

  At three photos a day that is about $0.07 a month with Haiku and $1.30 with Sonnet. Busier plates (more foods)
  give more output tokens.

## Privacy

- **The photo and the note are sent to Anthropic** (`api.anthropic.com`) under the API terms of the key's account.
  Nothing else is sent: no name, email, history or Nutrition data.
- The key lives only in the server's `.env` and is never logged; errors log the API's error type and message only.

## Kept photos

- Up to **6 photos per meal** (`MEAL_PHOTOS_MAX`), saved as `<DATA_DIR>/meal-photos/<meal id>/<photo id>.jpg`
  (`db/mealPhotoStore.ts`), each the resized JPEG, usually **200–400 KB**; Nutrition stores no images. Photo ids start
  with the creation time, so the order is the order they were added. The single `<meal id>.jpg` of earlier versions is
  moved into the meal's folder when the server starts.
- Shown as a carousel on top of the meal detail (swipe, arrows, "2 / 3") and as the first photo with the number of
  photos on the Timeline card.
- **Modifica pasto** (part on): the same carousel with a × on each photo and an "Aggiungi foto" tile (camera or library).
  A new photo asks "Vuoi aggiungere al pasto i cibi di questa foto?": "Aggiungi i cibi con Claude" recognizes only
  that photo (with an optional note) and adds its foods as rows, "Solo la foto" keeps it as a photo. Nothing is saved
  until "Salva": the meal is updated first, then removed photos are deleted and new ones uploaded; if a photo fails, the
  meal stays saved and the screen says so.
- API (owner only, hidden while the part is off): `GET /api/meals/photos` → `{ photos: { <meal id>: [photo ids] } }`;
  `GET /api/meals/:id/photos/:photoId`; `GET /api/meals/:id/photo` (the first one); `POST /api/meals/:id/photos` with
  `{ mediaType: "image/jpeg", data }` → `{ photoId }` (409 `too_many_photos` after 6); `DELETE /api/meals/:id/photos/:photoId`;
  `POST /api/meals` takes `photos` (up to 6). Only JPEGs up to 3 MB are kept; ids are validated, so no other file can be reached.
- Deleting the meal in Intake deletes all its photos. Turning the part off hides the photos (their routes answer 404
  `feature_disabled`) but keeps them.
- **Backups:** the photos are in the data volume, so every `deploy.sh` volume backup contains all of them (JPEG does
  not compress further). At 3 photos a day that is about 0.3–0.4 GB a year (more if you add several photos per meal), and `deploy.sh` keeps 10 volume backups,
  so up to ten times that in `backups/`. They are **not** part of the nightly Nutrition backup
  ([backups.md](backups.md)), which only holds Nutrition's own export.

## Errors

| Answer | Message in the app |
|---|---|
| 503 `recognition_not_configured` | `ANTHROPIC_API_KEY` missing |
| 502 `recognition_auth` | invalid key |
| 402 `recognition_credit` | no credit left (`PaymentRequiredError` or a `billing_error`) |
| 503 `recognition_busy` | Claude busy (rate limit or overloaded, after the SDK retries) |
| 422 `recognition_refused` | Claude declined (`stop_reason: refusal`) |
| 502 `recognition_unreadable` | the answer was cut at `max_tokens`, or did not describe a meal |
| 502 `recognition_failed` | any other failure, including a timeout |
