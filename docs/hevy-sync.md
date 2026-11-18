# Copying openGym workouts to Hevy

Optional and off by default. When both Hevy (`HEVY_API_KEY`) and openGym (`OPENGYM_URL` + `OPENGYM_TOKEN`) are
configured, Profile › Connections shows **Copy to Hevy** (Copia su Hevy). Turned on, the server copies the sessions
logged in openGym into Hevy, so Hevy's history stays complete while openGym is where sessions are logged. It works
whichever workout source is active in Intake.

## What is copied

- Workouts of the **last 30 days** with at least one done set (an opened-and-closed session is skipped).
- A workout that **already exists in Hevy** is never copied: any Hevy workout overlapping it for at least half of the
  shorter one counts (sessions logged in Hevy, or imported into openGym from Hevy, keep their times).
- Title, start and end, every exercise with its done sets: weight (converted to kg when openGym uses lb), reps,
  warm-ups as `warmup` sets, RPE rounded to the values Hevy accepts (6, 7, 7.5 … 10; below 6 left out), cardio sets as
  duration and distance (from minutes and average speed).
- Copies are created as **private** Hevy workouts (`is_private: true`), so they do not appear in followers' feeds.
- A copied workout that changes later in openGym (a set fixed, a time corrected) is **updated** in Hevy. Nothing is
  ever deleted in Hevy, and edits made in Hevy to a copy are overwritten only if the openGym workout changes.

## Exercises

- Each openGym exercise is sent as the Hevy exercise **learned from workouts present in both apps**: an openGym entry
  whose done sets are exactly those of one Hevy exercise in the twin workout is that exercise; the template matched
  most often wins. With an import from Hevy, this covers every exercise ever done in Hevy.
- An exercise never done in Hevy becomes a **custom Hevy exercise**, created once with the openGym name, a type
  (weight and reps, reps only, duration, or distance and duration) and an equipment category guessed from the name.
- The Profile row lists what the next run would send, with the Hevy exercise each openGym exercise becomes or
  "new exercise on Hevy".

## When it runs

- Right away when it is turned on, then every **15 minutes** while it is on, and on **Copy now** (Copia ora).
- Hevy is read through the same client as the workout source (pages cached for 5 minutes; cleared after a write).
- An error (Hevy or openGym not answering) is shown in Profile; whatever was sent before it stays linked, the rest is
  retried on the next run.

## What is stored

In SQLite, only links: which openGym workout became which Hevy workout, with a hash of what was sent
(`hevy_sync_links`), and which Hevy exercise stands for each openGym exercise (`hevy_exercise_links`, learned or
custom). The on/off switch and the last run are in the settings table. Workouts are never stored.

## Notes

- openGym is only read (the token stays read-only); the only writes are to Hevy, with the owner's API key.
- Hevy may write the copies to Apple Health like the workouts logged in the app. Intake already merges a Hevy record
  with the watch's record of the same session (docs/apple-health.md). If Apple Health shows them twice, turn off
  writing workouts to Health in Hevy's settings.
- If openGym is set to keep importing from Hevy, the copies would come back into openGym as duplicates: import from
  Hevy once, then let openGym be the place where sessions are logged.
