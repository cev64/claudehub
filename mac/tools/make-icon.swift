// Draws the ClaudeHub app icon (1024x1024 PNG) with CoreGraphics.
// Usage: make-icon <out.png>. scripts/build-mac-app.sh turns it into AppIcon.icns.
//
// Design: a rounded square on the macOS icon grid (824pt body, soft shadow) with a blue gradient
// around the dashboard accent, and a white hub glyph: a centre node, three spokes to outer nodes
// and a faint orbit ring.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let size = 1024
let space = CGColorSpace(name: CGColorSpace.sRGB)!
guard let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                          space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
    fatalError("could not create context")
}

func rgb(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(colorSpace: space, components: [
        CGFloat((hex >> 16) & 0xFF) / 255, CGFloat((hex >> 8) & 0xFF) / 255, CGFloat(hex & 0xFF) / 255, alpha,
    ])!
}

let body = CGRect(x: 100, y: 100, width: 824, height: 824)
let shape = CGPath(roundedRect: body, cornerWidth: 186, cornerHeight: 186, transform: nil)

// Shadow under the body.
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: rgb(0x08204F, 0.32))
ctx.addPath(shape)
ctx.setFillColor(rgb(0x3B6CF6))
ctx.fillPath()
ctx.restoreGState()

// Gradient fill (CoreGraphics y points up: start is the top).
ctx.saveGState()
ctx.addPath(shape)
ctx.clip()
let gradient = CGGradient(colorsSpace: space, colors: [rgb(0x6A97FF), rgb(0x3B6CF6), rgb(0x2549D8)] as CFArray,
                          locations: [0, 0.55, 1])!
ctx.drawLinearGradient(gradient, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])
// Soft light from the top.
let glow = CGGradient(colorsSpace: space, colors: [rgb(0xFFFFFF, 0.22), rgb(0xFFFFFF, 0)] as CFArray,
                      locations: [0, 1])!
ctx.drawRadialGradient(glow, startCenter: CGPoint(x: 512, y: 980), startRadius: 0,
                       endCenter: CGPoint(x: 512, y: 980), endRadius: 620, options: [])
// Faint inner highlight along the top edge.
ctx.addPath(CGPath(roundedRect: body.insetBy(dx: 1.5, dy: 1.5), cornerWidth: 185, cornerHeight: 185, transform: nil))
ctx.setStrokeColor(rgb(0xFFFFFF, 0.18))
ctx.setLineWidth(3)
ctx.strokePath()
ctx.restoreGState()

// Hub glyph.
let center = CGPoint(x: 512, y: 500)
let orbit: CGFloat = 228
let angles: [CGFloat] = [90, 210, 330].map { $0 * .pi / 180 }
let nodes = angles.map { CGPoint(x: center.x + orbit * cos($0), y: center.y + orbit * sin($0)) }

ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -6), blur: 18, color: rgb(0x0A1F7A, 0.28))
ctx.beginTransparencyLayer(auxiliaryInfo: nil)

ctx.setStrokeColor(rgb(0xFFFFFF, 0.38))
ctx.setLineWidth(16)
ctx.strokeEllipse(in: CGRect(x: center.x - orbit, y: center.y - orbit, width: orbit * 2, height: orbit * 2))

ctx.setStrokeColor(rgb(0xFFFFFF))
ctx.setLineWidth(30)
ctx.setLineCap(.round)
for node in nodes {
    ctx.move(to: center)
    ctx.addLine(to: node)
}
ctx.strokePath()

ctx.setFillColor(rgb(0xFFFFFF))
ctx.fillEllipse(in: CGRect(x: center.x - 86, y: center.y - 86, width: 172, height: 172))
for node in nodes {
    ctx.fillEllipse(in: CGRect(x: node.x - 58, y: node.y - 58, width: 116, height: 116))
}
// Small accent-blue core so the centre reads as a hub, not a dot.
ctx.setFillColor(rgb(0x3B6CF6))
ctx.fillEllipse(in: CGRect(x: center.x - 34, y: center.y - 34, width: 68, height: 68))

ctx.endTransparencyLayer()
ctx.restoreGState()

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write("usage: make-icon <out.png>\n".data(using: .utf8)!)
    exit(2)
}
let out = URL(fileURLWithPath: CommandLine.arguments[1])
guard let image = ctx.makeImage(),
      let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    fatalError("could not create image")
}
CGImageDestinationAddImage(dest, image, nil)
guard CGImageDestinationFinalize(dest) else { fatalError("could not write \(out.path)") }
