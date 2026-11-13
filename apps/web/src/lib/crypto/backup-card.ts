// Backup "cards": a PNG people recognise, can print and keep, instead of a raw .json file.
// The (already passphrase-encrypted) backup travels two ways inside the same image:
//  1. a PNG tEXt chunk with the exact JSON (read back from the original file), and
//  2. a QR code drawn on the card (read back if the image was re-saved, screenshotted or printed and photographed).
// Neither is useful without the passphrase.
import QRCode from "qrcode"
import jsQR from "jsqr"

const KEYWORD = "secvote-backup"
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export type CardText = {
  /** e.g. "Voting identity backup" */
  heading: string
  title: string
  subtitle: string
  /** label/value pairs shown under the title */
  facts: [string, string][]
  /** short instructions, one per line */
  notes: string[]
}

// ---------------------------------------------------------------- PNG chunks
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function textChunk(keyword: string, text: string): Uint8Array {
  const data = new TextEncoder().encode(`${keyword}\0${text}`)
  const type = new TextEncoder().encode("tEXt")
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(type, 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** Insert a tEXt chunk right after IHDR (signature 8 bytes + IHDR chunk 25 bytes). */
function withText(png: Uint8Array, keyword: string, text: string): Uint8Array {
  const at = 8 + 25
  const chunk = textChunk(keyword, text)
  const out = new Uint8Array(png.length + chunk.length)
  out.set(png.subarray(0, at))
  out.set(chunk, at)
  out.set(png.subarray(at), at + chunk.length)
  return out
}

function readText(png: Uint8Array, keyword: string): string | null {
  if (!PNG_SIG.every((b, i) => png[i] === b)) return null
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  let off = 8
  while (off + 8 <= png.length) {
    const len = view.getUint32(off)
    const type = String.fromCharCode(...png.subarray(off + 4, off + 8))
    if (type === "tEXt") {
      const data = new TextDecoder().decode(png.subarray(off + 8, off + 8 + len))
      const sep = data.indexOf("\0")
      if (data.slice(0, sep) === keyword) return data.slice(sep + 1)
    }
    if (type === "IEND") break
    off += 12 + len
  }
  return null
}

// ---------------------------------------------------------------- drawing
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ""
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line)
      line = w
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

/** Draw the card and return it as a PNG with `payload` embedded (tEXt chunk + QR code). */
export async function makeBackupCard(payload: string, t: CardText): Promise<Blob> {
  const W = 1400
  const H = 820
  const canvas = document.createElement("canvas")
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext("2d")!
  const navy = "#0b1f44"
  const saffron = "#e8861a"
  const ink = "#16213a"
  const muted = "#5b6478"
  const serif = 'Georgia, "Source Serif 4", "Times New Roman", serif'
  const sans = '"Public Sans", "Segoe UI", Arial, sans-serif'

  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, W, H)
  // header band
  ctx.fillStyle = navy
  ctx.fillRect(0, 0, W, 130)
  ctx.fillStyle = saffron
  ctx.fillRect(0, 130, W, 6)
  ctx.fillStyle = "#ffffff"
  ctx.font = `bold 44px ${serif}`
  ctx.fillText("SecVote", 60, 78)
  ctx.font = `600 20px ${sans}`
  ctx.fillStyle = "rgba(255,255,255,0.75)"
  ctx.fillText("SECURE ELECTRONIC VOTING", 60, 108)
  ctx.textAlign = "right"
  ctx.fillStyle = "#ffffff"
  ctx.font = `600 28px ${sans}`
  ctx.fillText(t.heading, W - 60, 82)
  ctx.textAlign = "left"

  // left column: what this is
  const left = 60
  const colW = 760
  let y = 210
  ctx.fillStyle = saffron
  ctx.font = `bold 20px ${sans}`
  ctx.fillText(t.subtitle.toUpperCase(), left, y)
  y += 52
  ctx.fillStyle = ink
  ctx.font = `bold 46px ${serif}`
  for (const line of wrap(ctx, t.title, colW).slice(0, 2)) {
    ctx.fillText(line, left, y)
    y += 56
  }
  y += 10
  ctx.font = `20px ${sans}`
  for (const [k, v] of t.facts) {
    ctx.fillStyle = muted
    ctx.fillText(k, left, y)
    ctx.fillStyle = ink
    ctx.font = `600 20px ${sans}`
    ctx.fillText(v, left + 190, y)
    ctx.font = `20px ${sans}`
    y += 34
  }
  // notes box
  y += 16
  const boxTop = y
  ctx.font = `20px ${sans}`
  const noteLines = t.notes.flatMap((n) => [...wrap(ctx, n, colW - 60), ""])
  const boxH = noteLines.length * 28 + 30
  ctx.fillStyle = "#fdf4e1"
  ctx.fillRect(left, boxTop, colW, boxH)
  ctx.fillStyle = saffron
  ctx.fillRect(left, boxTop, 6, boxH)
  ctx.fillStyle = ink
  let ny = boxTop + 40
  for (const line of noteLines) {
    if (line) ctx.fillText(line, left + 30, ny)
    ny += line ? 28 : 10
  }

  // right column: QR code
  const qr = document.createElement("canvas")
  await QRCode.toCanvas(qr, payload, { errorCorrectionLevel: "M", margin: 2, width: 440, color: { dark: navy, light: "#ffffff" } })
  const qx = W - 60 - 440
  const qy = 190
  ctx.strokeStyle = "#d8dce6"
  ctx.lineWidth = 2
  ctx.strokeRect(qx - 12, qy - 12, 464, 464)
  ctx.drawImage(qr, qx, qy, 440, 440)
  ctx.fillStyle = muted
  ctx.font = `18px ${sans}`
  ctx.textAlign = "center"
  ctx.fillText("Upload this image (or a photo of it) to restore", qx + 220, qy + 490)
  ctx.textAlign = "left"

  // footer
  ctx.fillStyle = "#eef1f6"
  ctx.fillRect(0, H - 60, W, 60)
  ctx.fillStyle = muted
  ctx.font = `16px ${sans}`
  ctx.fillText("Encrypted with your passphrase. Useless without it. It never reveals how you vote.", left, H - 24)

  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Could not draw the backup"))), "image/png"))
  const png = new Uint8Array(await blob.arrayBuffer())
  return new Blob([withText(png, KEYWORD, payload) as BlobPart], { type: "image/png" })
}

export function saveBlob(blob: Blob, filename: string) {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1_000)
}

/** The embedded text from a backup card (PNG chunk, else its QR code), or a legacy .json backup's text. */
export async function readBackupFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const head = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart()
  if (head.startsWith("{")) return new TextDecoder().decode(bytes) // older .json backups
  const embedded = readText(bytes, KEYWORD)
  if (embedded) return embedded
  // Re-saved, screenshotted or photographed: find the QR code in the picture.
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error("That file isn't a SecVote backup. Choose the backup image you downloaded.")
  }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const code = jsQR(img.data, img.width, img.height)
  if (!code?.data) throw new Error("Couldn't read the QR code in that image. Use the original backup file, or a sharper photo.")
  return code.data
}
