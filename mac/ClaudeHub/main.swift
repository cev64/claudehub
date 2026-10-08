// ClaudeHub.app: a native window onto the ClaudeHub agent's dashboard (http://127.0.0.1:4317).
// Built with scripts/build-mac-app.sh (swiftc, no Xcode project).
import AppKit

let app = NSApplication.shared
let appDelegate = AppDelegate()
app.delegate = appDelegate
app.setActivationPolicy(.regular)
app.run()
