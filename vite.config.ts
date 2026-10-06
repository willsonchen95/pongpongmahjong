import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

// The version shown at the bottom of the main menu: package.json's version, and the day it was built.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
})
