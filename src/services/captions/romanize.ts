/**
 * Romanize Devanagari (Hindi) text into casual Latin "Hinglish" — e.g.
 * "कहानी सुनो" → "kahani suno", "दिल की बात" → "dil ki bat".
 *
 * Hindi and Urdu are the same spoken language (Hindustani); Whisper is asked to
 * transcribe the speech as Hindi (Devanagari), and this converts that to the
 * roman script people actually type in captions. It is deliberately loose
 * (single vowels, final-schwa dropped) rather than a strict scholarly scheme,
 * because the goal is readable Hinglish, not a reversible transliteration.
 */

// Consonants → base Latin (the inherent "a" is added separately).
const CONSONANTS: Record<string, string> = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "ng",
  "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "ny",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
  "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
  "य": "y", "र": "r", "ल": "l", "ळ": "l", "व": "v",
  "श": "sh", "ष": "sh", "स": "s", "ह": "h",
  "ऩ": "n", "ऱ": "r", "ऴ": "zh",
  // Precomposed nukta consonants (Urdu/Persian sounds).
  "क़": "q", "ख़": "kh", "ग़": "gh", "ज़": "z", "ड़": "r",
  "ढ़": "rh", "फ़": "f", "य़": "y",
};

// Base consonant + nukta (U+093C) → Latin, for decomposed forms.
const NUKTA: Record<string, string> = {
  "क": "q", "ख": "kh", "ग": "gh", "ज": "z", "ड": "r",
  "ढ": "rh", "फ": "f", "य": "y",
};

// Independent vowels.
const VOWELS: Record<string, string> = {
  "अ": "a", "आ": "a", "इ": "i", "ई": "i", "उ": "u",
  "ऊ": "u", "ऋ": "ri", "ॠ": "ri", "ऌ": "li",
  "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au",
  "ऍ": "e", "ऑ": "o", "ऎ": "e", "ऒ": "o",
};

// Dependent vowel signs (matras) — replace the inherent "a".
const MATRAS: Record<string, string> = {
  "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u",
  "ृ": "ri", "ॄ": "ri", "े": "e", "ै": "ai", "ो": "o",
  "ौ": "au", "ॅ": "e", "ॉ": "o", "ॆ": "e", "ॊ": "o",
};

// Standalone signs / punctuation.
const SIGNS: Record<string, string> = {
  "ं": "n", // anusvara
  "ँ": "n", // chandrabindu
  "ः": "h", // visarga
  "ऽ": "", // avagraha
  "ॐ": "om",
  "।": ".", // danda
  "॥": ".", // double danda
  "०": "0", "१": "1", "२": "2", "३": "3", "४": "4",
  "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
};

const VIRAMA = "्";
const NUKTA_SIGN = "़";

function isDevanagariLetter(ch: string | undefined): boolean {
  if (!ch) return false;
  const c = ch.codePointAt(0)!;
  return c >= 0x0900 && c <= 0x097f;
}

/** Convert a Devanagari string to loose lowercase Latin Hinglish. */
export function romanizeDevanagari(input: string): string {
  const chars = [...input];
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const cons = CONSONANTS[ch];
    if (cons) {
      // Absorb a following nukta sign into the consonant.
      let base = cons;
      let j = i;
      if (chars[i + 1] === NUKTA_SIGN) {
        base = NUKTA[ch] ?? cons;
        j = i + 1;
      }
      const next = chars[j + 1];
      if (next === VIRAMA) {
        out += base; // half consonant (conjunct) — no vowel
        i = j + 1;
      } else if (next && MATRAS[next]) {
        out += base + MATRAS[next];
        i = j + 1;
      } else {
        // Inherent "a", except drop the final schwa at a word end.
        const wordEnd = !next || !isDevanagariLetter(next);
        out += base + (wordEnd ? "" : "a");
        i = j;
      }
      continue;
    }
    if (VOWELS[ch] !== undefined) {
      out += VOWELS[ch];
    } else if (SIGNS[ch] !== undefined) {
      out += SIGNS[ch];
    } else if (ch === NUKTA_SIGN || ch === VIRAMA) {
      // stray sign with no base — ignore
    } else {
      out += ch; // Latin, spaces, digits, punctuation pass through
    }
  }
  return out;
}
