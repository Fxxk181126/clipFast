const fs = require('fs')
const path = require('path')
const png2icons = require('png2icons')

const source = process.env.CLIPFAST_ICON || '/Users/zhaojiong/workSpace/clipFast/图标.png'
const outDir = path.join(__dirname, '..', 'assets')

;(async () => {
  if (!fs.existsSync(source)) {
    process.stderr.write(`Icon source not found: ${source}\n`)
    process.exit(1)
  }
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const buf = fs.readFileSync(source)
  const icns = png2icons.createICNS(buf, png2icons.BICUBIC, 0, false)
  const ico = png2icons.createICO(buf, png2icons.BICUBIC, 0, false, true, false)
  if (!icns || !ico) throw new Error('Icon conversion failed')
  fs.writeFileSync(path.join(outDir, 'icon.icns'), icns)
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico)
  // 也复制一份 png 供运行时托盘等使用
  fs.copyFileSync(source, path.join(outDir, 'icon.png'))
  process.stdout.write('Icons generated to assets/ (icns, ico, png)\n')
})().catch(err => { process.stderr.write(String(err) + '\n'); process.exit(1) })
