import AVFoundation
import Speech
import Darwin
import Foundation

func fail(_ why: String) -> Never {
  fputs("BossGoat local speech: \(why)\n", stderr)
  exit(1)
}

// Give macOS a separate speech-permission identity, as the existing audio helper does.
var child: pid_t = 0

func ownResponsibility() {
  if getenv("BOSSGOAT_SPEECH_OWN") != nil { return }
  typealias Disclaim = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32
  guard let sym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_spawnattrs_setdisclaim") else { return }
  let disclaim = unsafeBitCast(sym, to: Disclaim.self)
  var attr: posix_spawnattr_t? = nil
  guard posix_spawnattr_init(&attr) == 0 else { return }
  defer { posix_spawnattr_destroy(&attr) }
  guard disclaim(&attr, 1) == 0 else { return }
  // The environment to pass on, by dlsym too: _NSGetEnviron's header (crt_externs.h) is an explicit submodule that
  // `import Darwin` no longer shows from Swift 6.4 on (#789), and naming the submodule ties the build to one SDK's layout.
  typealias Environ = @convention(c) () -> UnsafeMutablePointer<UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?>
  guard let envSym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "_NSGetEnviron") else { return }
  let nsEnviron = unsafeBitCast(envSym, to: Environ.self)
  setenv("BOSSGOAT_SPEECH_OWN", "1", 1)
  let path = Bundle.main.executablePath ?? CommandLine.arguments[0]
  let argv: [UnsafeMutablePointer<CChar>?] = CommandLine.arguments.map { strdup($0) } + [nil]
  var pid: pid_t = 0
  let rc = argv.withUnsafeBufferPointer { posix_spawn(&pid, path, nil, &attr, $0.baseAddress, nsEnviron().pointee) }
  if rc != 0 { unsetenv("BOSSGOAT_SPEECH_OWN"); return } // runs here instead
  child = pid
  // (SIGUSR1 too: a call's "drop what's queued", which the child ignores until it's ready for it)
  for s in [SIGTERM, SIGINT, SIGHUP, SIGUSR1] { signal(s) { sig in _ = kill(child, sig) } }
  // the program that started it gone (killed outright): the child goes too, even mid-prompt
  let parent = getppid()
  let watch = DispatchSource.makeTimerSource(queue: .global())
  watch.schedule(deadline: .now() + 0.5, repeating: 0.5)
  watch.setEventHandler { if getppid() != parent { kill(child, SIGTERM); exit(0) } }
  watch.resume()
  keep.append(watch)
  var status: Int32 = 0
  while waitpid(pid, &status, 0) < 0 && errno == EINTR {}
  let sig = status & 0x7f
  exit(sig == 0 ? (status >> 8) & 0xff : 128 + sig)
}

// Ends with the program that started it (its parent gone: nobody reads or writes the audio any more).
func endWithParent() {
  let parent = getppid()
  let t = DispatchSource.makeTimerSource(queue: .global())
  t.schedule(deadline: .now() + 0.5, repeating: 0.5)
  t.setEventHandler { if getppid() != parent { exit(0) } }
  t.resume()
  keep.append(t)
}
var keep: [Any] = []

ownResponsibility()
endWithParent()
guard CommandLine.arguments.count == 2 else { fail("Expected check or an audio file.") }
guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.supportsOnDeviceRecognition else {
  fail("English on-device speech recognition is unavailable. Enable English (US) Dictation in System Settings > Keyboard and download its speech files, then try again.")
}
var authorization: SFSpeechRecognizerAuthorizationStatus?
SFSpeechRecognizer.requestAuthorization { authorization = $0 }
while authorization == nil { RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05)) }
guard authorization == .authorized else { fail("Allow herdr-speech in System Settings > Privacy & Security > Speech Recognition, then try again.") }
if CommandLine.arguments[1] == "check" { print("ready"); exit(0) }
let request = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: CommandLine.arguments[1]))
request.requiresOnDeviceRecognition = true
request.shouldReportPartialResults = false
request.taskHint = .dictation
var finished = false
var output = ""
var failure: String?
let task = recognizer.recognitionTask(with: request) { result, error in
  if let result = result, result.isFinal { output = result.bestTranscription.formattedString; finished = true }
  if let error = error, !finished {
    let e = error as NSError
    if e.code != 1110 { failure = error.localizedDescription }
    finished = true
  }
}
let until = Date(timeIntervalSinceNow: 30)
while !finished && Date() < until { RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05)) }
task.cancel()
if !finished { fail("On-device transcription timed out.") }
if let failure = failure { fail(failure) }
print(output)
