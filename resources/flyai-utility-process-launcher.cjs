'use strict'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isAbsolute } = require('node:path')

const targetModulePath = process.argv[2]
const targetArgs = process.argv.slice(3)

if (!targetModulePath || !isAbsolute(targetModulePath) || targetArgs.length === 0) {
  process.stderr.write('FlyAI utility process launcher arguments are invalid.\n')
  process.exit(64)
}

// Commander auto-detects Electron and, outside Electron's default app, parses
// user arguments from argv[1]. Remove both launcher and target module paths.
process.argv = [process.argv[0], ...targetArgs]
// eslint-disable-next-line @typescript-eslint/no-require-imports
require(targetModulePath)
