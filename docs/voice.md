# Voice calls

Choose the provider in **Settings → Agents → Voice calls**. Changes apply to the next call:

- **Codex (experimental)** uses your existing ChatGPT sign-in and Codex voice.
- **Claude (local speech)** uses your signed-in Claude Code and your Mac's speech recognition and spoken output.
- **Cursor (local speech)** uses your signed-in Cursor CLI and the same local speech.
- **ElevenLabs** uses its own API key.

Every provider uses BossGoat's existing controls and can send work to your Claude Code, Codex, and Cursor agents.

Codex must be installed and signed in with ChatGPT on the machine running the call: your computer for the desktop app, or the machine serving BossGoat for web calls. Use `codex login` there if needed. API-key sign-in is refused for this provider; BossGoat does not copy your credentials or fall back to paid API access.

This integration uses the experimental Codex app-server WebRTC v3 interface, verified with Codex 0.169.0. It uses your plan's voice allowance and any applicable credits. It is not unlimited, and account eligibility and upstream changes can affect it. The WebRTC audio dependency is installed by `bossgoat update`; unsupported platforms report a setup error.

For Claude and Cursor, local speech currently requires macOS, Apple's command line tools, and on-device English (US) speech recognition. The helper builds on first use. If macOS asks, allow **herdr-speech** under Privacy & Security → Speech Recognition. If English speech files are missing, enable English (US) Dictation under System Settings → Keyboard and let its files download. Audio is transcribed on the machine running the call; only text is sent to the chosen agent. For web calls, this is the Mac serving BossGoat. Linux servers report that local speech is unavailable.

Claude and Cursor handle one utterance after you pause. Responses may take longer than Codex's realtime voice, especially when a lookup needs a second agent response. Speaking interrupts queued playback. Calls use the CLI's default model and normal plan limits. The provider must pass a subscription sign-in check; environment API keys are not used. The controller's CLI tools are disabled or denied; requested actions go through BossGoat's existing handlers and confirmations. Temporary audio is removed when processed and the temporary call folder is removed at hangup. Cursor may retain text in its normal CLI conversation history.

Start a call with the voice button beside Search. Mute, End, interruption, navigation, agent messages, and the existing action confirmations work through the same BossGoat controls. The Codex voice controller has a separate temporary session with command execution and external connections disabled. Existing agents retain their own model and permissions.

**The microphone inside a chat composer is dictation.** It still uses ElevenLabs Scribe. The voice provider choice does not change composer dictation.

To return to the previous voice provider, select **ElevenLabs**. Existing installations keep that provider until you select Codex. Changing providers applies to the next call.

References: [Codex app-server](https://developers.openai.com/codex/app-server/), [Codex plan and voice usage](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan).
