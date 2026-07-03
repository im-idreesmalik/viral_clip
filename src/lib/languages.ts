/**
 * Spoken-language options for transcription (whisper.cpp -l codes).
 * "auto" lets Whisper detect, but close languages (Urdu vs Hindi) are often
 * mis-detected — so picking explicitly is more reliable.
 */
export const LANGUAGES: { code: string; label: string }[] = [
  { code: "auto", label: "Auto-detect" },
  { code: "en", label: "English" },
  { code: "ur", label: "Urdu" },
  { code: "hi", label: "Hindi" },
  { code: "pa", label: "Punjabi" },
  { code: "ar", label: "Arabic" },
  { code: "ps", label: "Pashto" },
  { code: "bn", label: "Bengali" },
  { code: "fa", label: "Persian" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "ru", label: "Russian" },
  { code: "tr", label: "Turkish" },
  { code: "id", label: "Indonesian" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
];
