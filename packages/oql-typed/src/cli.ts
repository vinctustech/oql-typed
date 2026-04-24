#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs'
import { parseDMAndGenerate } from './parse-dm.js'

const args = process.argv.slice(2)

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: oql-typed-codegen <input.dm> [output.ts]

Generates TypeScript schema definitions from an OQL data model (.dm) file.

If output is omitted, prints to stdout.

Examples:
  oql-typed-codegen schema.dm src/schema.generated.ts
  cat schema.dm | oql-typed-codegen -`)
  process.exit(0)
}

const inputPath = args[0]
const outputPath = args[1]

let dmString: string

if (inputPath === '-') {
  dmString = readFileSync(0, 'utf-8')
} else {
  dmString = readFileSync(inputPath, 'utf-8')
}

const tsSource = parseDMAndGenerate(dmString)

if (outputPath) {
  writeFileSync(outputPath, tsSource, 'utf-8')
  console.log(`Generated ${outputPath}`)
} else {
  console.log(tsSource)
}
