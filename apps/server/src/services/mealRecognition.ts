import type { Language, RecognizedMeal } from "@intake/shared";
import Anthropic, {
  APIError,
  AuthenticationError,
  InternalServerError,
  PaymentRequiredError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import type { ContentBlockParam, Message } from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";

/** What the user sends: photos of the plate (e.g. one per course), a free description, or both. */
export interface RecognitionInput {
  images?: Array<{ mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string }>;
  text?: string;
}

export type RecognitionFailure = "auth" | "credit" | "busy" | "refused" | "unreadable" | "failed";

/** The Claude API call did not give a usable answer. `reason` decides the HTTP status and the message in the app. */
export class RecognitionError extends Error {
  constructor(
    readonly reason: RecognitionFailure,
    message: string,
  ) {
    super(message);
    this.name = "RecognitionError";
  }
}

const per100Schema = z.object({
  kcal: z.number().nonnegative(),
  protein: z.number().nonnegative(),
  carbs: z.number().nonnegative(),
  fat: z.number().nonnegative(),
  fiber: z.number().nonnegative().nullable().optional(),
  sugar: z.number().nonnegative().nullable().optional(),
  addedSugar: z.number().nonnegative().nullable().optional(),
});

const answerSchema = z.object({
  description: z.string().trim().min(1).max(300),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        grams: z.number().positive().max(3000),
        visible: z.boolean(),
        per100g: per100Schema,
      }),
    )
    .min(1)
    .max(20),
});

/**
 * JSON schema of the answer, sent as a structured output (output_config.format): the API guarantees an answer that
 * matches it. Number ranges are not supported there, so `answerSchema` checks them after.
 */
const ANSWER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["description", "items"],
  properties: {
    description: { type: "string", description: "Short description of the whole meal, in the language the system prompt asks for, e.g. \"Pasta al pomodoro con insalata mista\"." },
    items: {
      type: "array",
      description: "One entry per food, including oil, butter, sauces and dressings that are cooked in or poured on.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "grams", "visible", "per100g"],
        properties: {
          name: { type: "string", description: "Name of the food as eaten, in the language the system prompt asks for, e.g. \"Pasta al pomodoro (cotta)\", \"Olio extravergine d'oliva\"." },
          grams: { type: "number", description: "Estimated weight eaten, in grams (for drinks, millilitres treated as grams)." },
          visible: { type: "boolean", description: "False when the food is not visible in the photo but almost certainly present (e.g. cooking oil), or when there is no photo." },
          per100g: {
            type: "object",
            additionalProperties: false,
            description: "Nutrition per 100 g of this food as eaten (cooked weight for cooked foods).",
            required: ["kcal", "protein", "carbs", "fat", "fiber", "sugar", "addedSugar"],
            properties: {
              kcal: { type: "number" },
              protein: { type: "number" },
              carbs: { type: "number" },
              fat: { type: "number" },
              fiber: { type: "number", description: "Dietary fiber; 0 for foods with none (meat, fish, eggs, dairy, oil, sugar)." },
              sugar: { type: "number", description: "Total sugars; 0 for foods with none (meat, fish, eggs, oil, plain pasta and rice)." },
              addedSugar: { type: "number", description: "Added sugars, part of sugar; 0 for whole fruit, vegetables, plain milk and yogurt, meat, fish, pasta, oil." },
            },
          },
        },
      },
    },
  },
} as const;

const LANGUAGE_NAMES: Record<Language, string> = { it: "Italian", en: "English", nl: "Dutch" };

const system = (language: Language) => [
  "You estimate what a person ate from a photo of their plate and/or a short description, for a personal food diary.",
  "List every food separately with an estimated eaten weight in grams and nutrition per 100 g as eaten, using standard food composition values (e.g. CREA, USDA).",
  "Judge portion sizes from the plate, cutlery and food density; prefer typical home portions when unsure.",
  "Add cooking fats, dressings and sauces that are not visible but very likely present (mark them visible: false) with realistic amounts.",
  "If the description gives quantities or foods, they win over what the photo suggests.",
  `Write every name and the description in ${LANGUAGE_NAMES[language]}.`,
].join(" ");

/** The part of the SDK client the recognizer uses; tests pass a fake. */
export type MessagesClient = Pick<Anthropic["messages"], "create">;

export interface MealRecognizerOptions {
  apiKey: string;
  /** Model of the next request (Impostazioni › Pasti da foto, or RECOGNITION_MODEL). */
  model: () => string;
  client?: MessagesClient;
  /** Language of the food names and description (Profilo › Lingua); Italian when missing. */
  language?: () => Language;
  /** Token usage of each request, to see the real cost; never the photo, the text or the key. */
  log?: { info(details: object, message: string): void; warn(details: object, message: string): void };
}

/** Room for adaptive thinking (on by default on the 5.5 models, counted in max_tokens) and the answer; only what is generated is paid. */
const MAX_TOKENS = 16_000;
/** Each attempt; the SDK retries 429, 529 and connection errors twice by itself. */
const TIMEOUT_MS = 60_000;

/** The SDK error of a failed request, as the reason shown in the app. */
function failureOf(error: unknown): RecognitionFailure {
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) return "auth";
  if (error instanceof PaymentRequiredError || (error instanceof APIError && error.type === "billing_error")) return "credit";
  if (error instanceof RateLimitError || error instanceof InternalServerError) return "busy";
  return "failed";
}

/**
 * Recognizes the foods of a meal with the Claude API (vision): a structured output returns the foods, their
 * estimated grams and nutrition per 100 g. Nothing is stored; the user confirms or corrects before it is logged.
 */
export class MealRecognizer {
  private readonly client: MessagesClient;

  constructor(private readonly options: MealRecognizerOptions) {
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey, timeout: TIMEOUT_MS }).messages;
  }

  async recognize(input: RecognitionInput): Promise<RecognizedMeal> {
    const content: ContentBlockParam[] = [];
    const images = input.images ?? [];
    for (const image of images) content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } });
    const text = input.text?.trim();
    // Several photos are one meal: each course once, and the same food seen in two photos counted once
    const intro =
      images.length > 1
        ? `${images.length} photos of one meal (for example one per course, or the same plate before and after a second helping): list every food once, and count a food seen in more than one photo only once unless the photos clearly show two servings.`
        : images.length === 1
          ? "Photo of my meal."
          : null;
    content.push({ type: "text", text: intro ? `${intro}${text ? ` Notes: ${text}` : ""}` : `I ate: ${text ?? ""}` });
    const model = this.options.model();

    let response: Message;
    try {
      response = await this.client.create({
        model,
        max_tokens: MAX_TOKENS,
        system: system(this.options.language?.() ?? "it"),
        // Portion estimation needs little reasoning: low effort keeps thinking short, fast and cheap
        output_config: { effort: "low", format: { type: "json_schema", schema: ANSWER_JSON_SCHEMA } },
        messages: [{ role: "user", content }],
      });
    } catch (error) {
      // The API error type and message say why; they never contain the key
      const why = error instanceof APIError ? `Claude API error ${error.status ?? "-"} ${error.type ?? ""}: ${error.apiMessage ?? error.message}` : `Claude API not reachable: ${error instanceof Error ? error.message : String(error)}`;
      throw new RecognitionError(failureOf(error), why);
    }

    const usage = { model, stopReason: response.stop_reason, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, thinkingTokens: response.usage.output_tokens_details?.thinking_tokens ?? null };
    this.options.log?.info(usage, "meal recognition");
    if (response.stop_reason === "refusal") throw new RecognitionError("refused", "Claude declined to describe this meal");
    if (response.stop_reason === "max_tokens") {
      this.options.log?.warn(usage, "meal recognition stopped at max_tokens");
      throw new RecognitionError("unreadable", "Claude API answer was cut at max_tokens");
    }

    const answer = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    let json: unknown;
    try {
      json = JSON.parse(answer);
    } catch {
      throw new RecognitionError("unreadable", "Claude API answer is not JSON");
    }
    const parsed = answerSchema.safeParse(json);
    if (!parsed.success) throw new RecognitionError("unreadable", "Claude API answer did not match the meal schema");
    return {
      description: parsed.data.description,
      items: parsed.data.items.map((item) => ({
        name: item.name,
        grams: Math.round(item.grams),
        visible: item.visible,
        per100g: { ...item.per100g, fiber: item.per100g.fiber ?? null, sugar: item.per100g.sugar ?? null, addedSugar: item.per100g.addedSugar ?? null },
      })),
    };
  }
}
