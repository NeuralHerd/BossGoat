export const VOICE = {
  title: "Voice calls",
  about: "Codex uses ChatGPT voice. Claude and Cursor use their signed-in agents with English speech processed on this Mac. Plan limits apply. ElevenLabs uses its own key. Dictation is separate.",
  choices: [["elevenlabs", "ElevenLabs"], ["codex", "Codex (experimental)"], ["claude", "Claude (local speech)"], ["cursor", "Cursor (local speech)"]],
};
export const voiceProvider = (file) => {
  const provider = file?.everywhere?.voice?.provider;
  return VOICE.choices.some(([id]) => id === provider) ? provider : "elevenlabs";
};
