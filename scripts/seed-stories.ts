/**
 * Seed the AI Stories library with 15 English + 15 Urdu curiosity-driven story
 * prompts. Each row is created in GENERATING state and enqueued; the stories
 * worker then writes the full text with Claude and synthesizes the voice-over.
 *
 * Run with:  node --import tsx scripts/seed-stories.ts
 * Safe to re-run: skips topics that already exist.
 */
import "@/workers/loadEnv";
import { prisma } from "@/lib/db";
import { enqueueGenerateStory } from "@/lib/queue";

const DURATION_MIN = 9;

const ENGLISH: string[] = [
  "A deep-sea diver discovers a sealed door at the bottom of the ocean that should not exist, and what answers when she knocks.",
  "The last radio message a lighthouse keeper sent before he vanished without a trace — and the person who finally decodes it decades later.",
  "A woman inherits an old house where every clock is stopped at the exact same minute, and the night she hears one of them start ticking again.",
  "A hospital night-shift worker realizes the building has one more floor than the blueprints show, and what waits when the elevator finally stops there.",
  "A little girl's imaginary friend begins warning her family about things that keep coming true, until the warnings turn to the friend itself.",
  "A town forbids anyone from looking at the mountain after dark — and the one curious boy who finally does.",
  "A programmer finds a hidden folder on his laptop full of videos dated tomorrow, each one showing a choice he hasn't made yet.",
  "An astronaut alone on the station hears slow, deliberate knocking on the outside of the hull — three knocks, every night, at the same second.",
  "A quiet librarian discovers a book that rewrites itself to narrate the life of whoever is reading it, right up to the final page.",
  "A family on a long road trip keeps passing the same lonely gas station no matter which direction they drive — and the attendant who has been expecting them.",
  "A grandmother's secret recipe, once cooked, makes anyone who eats it vividly remember a life they never lived.",
  "A man wakes up each morning exactly one day younger than the last, racing to solve the mystery before he runs out of years.",
  "A radio station that only broadcasts at three in the morning — and the night it says the listener's name and asks a question only she can answer.",
  "A street painter's portraits secretly reveal the moment each subject will die, until the day he is asked to paint his own.",
  "A marine archaeologist maps a sunken city that every history book insists never existed, and the warning carved above its gate.",
];

const URDU: string[] = [
  "A traveler in the old walled city of Lahore stumbles into a bustling bazaar that only appears on moonless nights, where the merchants sell things that were never lost.",
  "A grandmother's locked trunk is found to contain a bundle of handwritten letters, each dated years into the future and addressed to her granddaughter.",
  "A villager follows a stray cat through the fields and discovers a hidden shrine that will answer one — and only one — question with the absolute truth.",
  "A boy in the mountains of Hunza calls into a valley and hears his own voice echo back, but with answers to questions he never asked aloud.",
  "A night train quietly stops at a small station that appears on no map and no timetable, and the single passenger who decides to step off.",
  "A humble calligrapher discovers that whatever sentence he writes comes true the moment the ink dries — a gift that slowly becomes a burden.",
  "In an ancestral haveli of the old city, an antique mirror reflects a warm, happy family that is not the one standing in front of it.",
  "A shepherd finds a sleeping stranger beneath a chinar tree who, when he finally wakes, claims to have slept for a hundred years — and remembers the shepherd.",
  "On her wedding day a bride notices her mehndi has formed words she never asked for — a hidden message meant for someone who was never invited.",
  "A fisherman on the Indus pulls up an old brass lamp that grants not wishes but memories — of lives, places, and people that may never have been real.",
  "A retired schoolteacher receives a neatly completed homework notebook from a student who left the school more than thirty years ago.",
  "A woman dreams of the same gentle stranger every single night, then meets him in a crowded bazaar — but he has no memory of her at all.",
  "The old clock tower of the city is said to chime thirteen times on one special night each year, and the watchman who stays awake to hear it.",
  "A quiet merchant in the bazaar trades in forgotten names — buying them cheap, selling them dear — and the terrible price he must eventually pay himself.",
  "A child who insists she can understand what the rain is trying to say, and the drought-stricken village that finally decides to listen to her.",
];

async function main() {
  let created = 0;
  let skipped = 0;
  const batches: { topic: string; language: "en" | "ur" }[] = [
    ...ENGLISH.map((topic) => ({ topic, language: "en" as const })),
    ...URDU.map((topic) => ({ topic, language: "ur" as const })),
  ];

  for (const { topic, language } of batches) {
    const exists = await prisma.story.findFirst({ where: { topic } });
    if (exists) {
      skipped++;
      continue;
    }
    const story = await prisma.story.create({
      data: { title: topic.slice(0, 120), topic, language, source: "AI", status: "GENERATING", text: "" },
    });
    await enqueueGenerateStory(story.id, DURATION_MIN);
    created++;
    console.log(`queued [${language}] ${story.id}`);
  }

  console.log(`\nDone. Queued ${created} new stories (${skipped} already existed).`);
  console.log("The stories worker will write + narrate them in the background.");
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
