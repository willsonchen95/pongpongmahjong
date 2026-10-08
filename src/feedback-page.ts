// The "Send feedback" page: a star rating, a comment and (if they'd like a reply) an email, sent to
// the owner's stats page (stats.ts). No account needed.

import { el, button, pageTitle } from './ui'
import { MAX_COMMENT } from '../server/stats-core'
import { sendFeedback } from './stats'

// `back`: where the back buttons go. `where`: which screen it was opened from ("menu", "game-end").
export function renderFeedbackPage(app: HTMLElement, back: () => void, where: string) {
  app.innerHTML = ''
  const card = el('div', 'setup feedback-page')
  card.append(pageTitle('Send feedback', back, 'Back'),
    el('p', 'setup-intro', 'What do you think of Pong Pong Mahjong? Tell me what you enjoy, what’s confusing, or what went wrong — every message is read.'))

  // the stars: tap one to rate, tap it again to take the rating away
  let rating: number | null = null
  const stars = el('div', 'fb-stars')
  stars.setAttribute('role', 'radiogroup')
  stars.setAttribute('aria-label', 'Your rating')
  const starButtons = [1, 2, 3, 4, 5].map(n => {
    const b = button('★', () => { rating = rating === n ? null : n; show() }, 'fb-star')
    b.setAttribute('role', 'radio')
    b.setAttribute('aria-label', `${n} star${n === 1 ? '' : 's'}`)
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
  comment.placeholder = 'I liked… / I got stuck when… / It would be great if…'
  const email = el('input', 'text-input') as HTMLInputElement
  email.type = 'email'
  email.autocomplete = 'email'
  email.maxLength = 200
  email.placeholder = 'you@example.com'
  const message = el('p', 'form-message')

  const send = button('Send feedback', async () => {
    const text = comment.value.trim(), mail = email.value.trim()
    if (rating === null && !text) { message.textContent = 'Pick some stars or write a few words first.'; return }
    if (mail && !email.checkValidity()) { message.textContent = 'That email doesn’t look right — or leave it empty.'; email.focus(); return }
    send.setAttribute('disabled', '')
    message.textContent = 'Sending…'
    if (await sendFeedback({ rating, comment: text, email: mail, where })) return thanks()
    send.removeAttribute('disabled')
    message.textContent = 'It couldn’t be sent — check your connection and try again.'
  }, 'act primary big')

  card.append(
    el('h2', 'setup-q', 'How do you like it?'), stars,
    el('h2', 'setup-q', 'Anything to say?'), comment,
    el('h2', 'setup-q', 'Your email (optional)'), el('p', 'setup-help', 'Only if you’d like a reply. It’s used for nothing else.'), email,
    message, send,
    el('p', 'fb-privacy', 'No account needed. The game counts plays anonymously — no names, no cookies — just to know how many people play.'),
  )
  app.appendChild(card)
  window.scrollTo(0, 0)

  function thanks() {
    app.innerHTML = ''
    const done = el('div', 'setup feedback-page')
    done.append(pageTitle('Thank you!', back, 'Back'),
      el('p', 'setup-intro', 'Your feedback is on its way. Thanks for playing Pong Pong Mahjong!'),
      button(where === 'menu' ? 'Back to the menu' : 'Back', back, 'act primary big'))
    app.appendChild(done)
  }
}
