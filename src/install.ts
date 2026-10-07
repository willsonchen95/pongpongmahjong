// Installing the game as an app: the offline helper, and the menu's Install button.
import { el, MENU_ICONS } from './ui'

// The offline helper (built into dist/sw.js) keeps the game on the device, so the home-screen app
// opens instantly and plays against bots with no connection. Not on the dev server, where it
// would hold on to old files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
// Chrome / Edge / Android hand us the install prompt to show when the player asks for it.
// iPhones and iPads have no prompt: the player adds it with Share → Add to Home Screen.
let installPrompt: (Event & { prompt(): Promise<unknown> }) | null = null
const installed = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
let iosHowTo = false              // the menu's "Install" card is showing the Add to Home Screen steps
// `menuChanged` redraws the menu (if it's showing) when the Install button appears or goes.
let menuChanged = () => {}
export function initInstall(onMenuChange: () => void) {
  menuChanged = onMenuChange
  addEventListener('beforeinstallprompt', e => {
    e.preventDefault()
    installPrompt = e as typeof installPrompt
    menuChanged()
  })
  addEventListener('appinstalled', () => { installPrompt = null; menuChanged() })
}

// The small menu button offering to install, when that's possible here (and it isn't installed already).
export function installButton(): HTMLElement | null {
  if (installed() || (!installPrompt && !isIos())) return null
  const b = el('button', 'menu-extra install' + (iosHowTo ? ' how' : ''))
  b.innerHTML = MENU_ICONS.install
  b.append(el('span', '', iosHowTo ? 'Tap Share, then “Add to Home Screen”' : 'Install the app'))
  b.title = 'Put it on your home screen — opens full screen, plays offline'
  const prompt = installPrompt
  b.onclick = prompt
    ? () => { installPrompt = null; void prompt.prompt().finally(menuChanged) }   // a prompt can only be shown once
    : () => { iosHowTo = !iosHowTo; menuChanged() }       // iPhone / iPad: no prompt, so show the steps
  return b
}
