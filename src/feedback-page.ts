// The "Send feedback" page: a star rating, a comment and (if they'd like a reply) an email, sent to
// the owner's stats page (stats.ts). No account needed.

import { el, button, pageTitle } from './ui'
import { t } from './i18n'
import { MAX_COMMENT } from '../server/stats-core'
import { sendFeedback } from './stats'

// Once a browser has given a rating, the end-of-game stars stay away for this long.
const RATED_KEY = 'mahjong-rated-at'
const ASK_AGAIN_MS = 30 * 24 * 60 * 60 * 1000
const markRated = () => { try { localStorage.setItem(RATED_KEY, String(Date.now())) } catch { /* fine */ } }
const ratedLately = () => { try { return Date.now() - Number(localStorage.getItem(RATED_KEY) ?? 0) < ASK_AGAIN_MS } catch { return false } }
let justRated: number | null = null                 // the stars given on this visit (the card then says thanks)

// "How do you like the game?" and five stars, for the final results: one tap sends the rating, then it
// says thanks and offers the full feedback page (`more`). Null if this browser rated lately.
export function quickRating(more: () => void): HTMLElement | null {
  if (justRated === null && ratedLately()) return null
  const box = el('div', 'quick-rate')
  if (justRated !== null) {
    box.append(el('span', 'qr-thanks', t('Thanks for the {stars}!', { stars: '★'.repeat(justRated) })), button(t('Tell us more ›'), more, 'qr-more'))
    return box
  }
  const stars = el('div', 'qr-stars')
  for (let n = 1; n <= 5; n++) {
    const b = button('★', () => {
      justRated = n
      markRated()
      void sendFeedback({ rating: n, comment: '', email: '', where: 'game-end' })
      box.replaceWith(quickRating(more)!)
    }, 'qr-star')
    b.setAttribute('aria-label', t(n === 1 ? '{n} star' : '{n} stars', { n }))
    stars.appendChild(b)
  }
  box.append(el('div', 'qr-q', t('How do you like the game?')), stars)
  return box
}

// `back`: where the back buttons go. `where`: which screen it was opened from ("menu", "game-end").
export function renderFeedbackPage(app: HTMLElement, back: () => void, where: string) {
  app.innerHTML = ''
  const card = el('div', 'setup feedback-page')
  card.append(pageTitle(t('Send feedback'), back, t('Back')),
    el('p', 'setup-intro', t('What do you think of Pong Pong Mahjong? Tell me what you enjoy, what’s confusing, or what went wrong — every message is read.')))

  // the stars: tap one to rate, tap it again to take the rating away
  let rating: number | null = null
  const stars = el('div', 'fb-stars')
  stars.setAttribute('role', 'radiogroup')
  stars.setAttribute('aria-label', t('Your rating'))
  const starButtons = [1, 2, 3, 4, 5].map(n => {
    const b = button('★', () => { rating = rating === n ? null : n; show() }, 'fb-star')
    b.setAttribute('role', 'radio')
    b.setAttribute('aria-label', t(n === 1 ? '{n} star' : '{n} stars', { n }))
    return b
  })
  const show = () => starButtons.forEach((b, i) => {
    b.classList.toggle('on', rating !== null && i < rating)
    b.setAttribute('aria-checked', String(rating === i + 1))
  })
  stars.append(...starButtons)
  show()

  const comment = el('textarea', 'text-input fb-comment') as HTMLTextAreaElement
  comment.maxLength = MAX_COMMENT
  comment.rows = 5
  comment.placeholder = t('I liked… / I got stuck when… / It would be great if…')
  const email = el('input', 'text-input') as HTMLInputElement
  email.type = 'email'
  email.autocomplete = 'email'
  email.maxLength = 200
  email.placeholder = 'you@example.com'
  const message = el('p', 'form-message')

  const send = button(t('Send feedback'), async () => {
    const text = comment.value.trim(), mail = email.value.trim()
    if (rating === null && !text) { message.textContent = t('Pick some stars or write a few words first.'); return }
    if (mail && !email.checkValidity()) { message.textContent = t('That email doesn’t look right — or leave it empty.'); email.focus(); return }
    send.setAttribute('disabled', '')
    message.textContent = t('Sending…')
    if (await sendFeedback({ rating, comment: text, email: mail, where })) { if (rating !== null) markRated(); return thanks() }
    send.removeAttribute('disabled')
    message.textContent = t('It couldn’t be sent — check your connection and try again.')
  }, 'act primary big')

  card.append(
    el('h2', 'setup-q', t('How do you like it?')), stars,
    el('h2', 'setup-q', t('Anything to say?')), comment,
    el('h2', 'setup-q', t('Your email (optional)')), el('p', 'setup-help', t('Only if you’d like a reply. It’s used for nothing else.')), email,
    message, send,
    el('p', 'fb-privacy', t('No account needed. The game counts plays anonymously — no names, no cookies — just to know how many people play.')),
  )
  app.appendChild(card)
  window.scrollTo(0, 0)

  function thanks() {
    app.innerHTML = ''
    const done = el('div', 'setup feedback-page')
    done.append(pageTitle(t('Thank you!'), back, t('Back')),
      el('p', 'setup-intro', t('Your feedback is on its way. Thanks for playing Pong Pong Mahjong!')),
      button(where === 'menu' ? t('Back to the menu') : t('Back'), back, 'act primary big'))
    app.appendChild(done)
  }
}
