import esbuild from 'esbuild'
import fs from 'fs'

const result = await esbuild.build({
  entryPoints: ['src/client/diagram-editor.js'],
  bundle: true,
  format: 'iife',
  outfile: 'client/diagram-editor.js',
  sourcemap: true,
  minify: true,
  metafile: true,
})

fs.writeFileSync('meta-client.json', JSON.stringify(result.metafile))
console.log('built client/diagram-editor.js')
