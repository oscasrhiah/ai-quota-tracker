// 產生托盤圖示 assets/tray.png（32x32，免第三方套件，直接手寫 PNG 編碼）
// 用法：node tools/make-icon.cjs
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const W = 32
const H = 32

const TEAL = [20, 184, 166, 255]
const DARK = [13, 110, 99, 255]
const WHITE = [255, 255, 255, 255]

function pixel(x, y) {
  const border = x < 3 || y < 3 || x >= W - 3 || y >= H - 3
  if (border) return DARK
  // 中央白色圓環（晶片造型）
  const inOuter = x >= 9 && x < 23 && y >= 9 && y < 23
  const inInner = x >= 12 && x < 20 && y >= 12 && y < 20
  if (inOuter && !inInner) return WHITE
  return TEAL
}

function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function main() {
  const raw = Buffer.alloc((W * 4 + 1) * H)
  let o = 0
  for (let y = 0; y < H; y++) {
    raw[o++] = 0 // filter: none
    for (let x = 0; x < W; x++) {
      const [r, g, b, a] = pixel(x, y)
      raw[o++] = r
      raw[o++] = g
      raw[o++] = b
      raw[o++] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])

  const dir = path.join(__dirname, '..', 'assets')
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, 'tray.png')
  fs.writeFileSync(out, png)
  console.log('wrote', out, png.length, 'bytes')
}

main()
