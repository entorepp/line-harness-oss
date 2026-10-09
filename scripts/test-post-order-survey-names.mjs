import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const html = fs.readFileSync(new URL('../apps/forms-studio/public/post-order-survey/index.html', import.meta.url), 'utf8')
const integration = fs.readFileSync(new URL('../apps/forms-studio/public/post-order-survey.js', import.meta.url), 'utf8')
const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
const definition = between(html, '{t:"row",e:"Full name"', '\n  {t:"select",e:"Relationship').trim().replace(/,$/, '')
const field = vm.runInNewContext(`(${definition})`)

// Minimal DOM fixture: execute the real row renderer and both validation paths.
class Element {
  constructor(tag, className = '', textContent = '') {
    Object.assign(this, { tag, className, textContent, children: [], dataset: {}, attributes: {}, value: '', style: {} })
    this.classList = { toggle() {} }
  }
  appendChild(child) { child.parent = this; this.children.push(child); return child }
  setAttribute(key, value) { this.attributes[key] = value }
  matches(selector) {
    return selector.split(',').some(part => {
      if (part.startsWith('.')) return this.className.split(' ').includes(part.slice(1))
      const match = part.match(/^([a-z]+)(?:\[type=["']?([^"'\]]+)["']?\])?$/)
      return match && this.tag === match[1] && (!match[2] || this.type === match[2])
    })
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]) }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) }
}

let checks = 0
for (const language of ['en', 'ja']) {
  for (const instance of [0, 1, 4]) {
    const count = new Element('span')
    const bar = new Element('div')
    const progress = new Element('div')
    const agree = { checked: true }
    let card
    const section = { querySelectorAll: () => [card], querySelector: () => count }
    const document = {
      createElement: tag => new Element(tag),
      querySelectorAll: selector => selector === 'section.sec' ? [section] : selector === '.q' ? [card] : [],
      getElementById: id => ({ agree, pbari: bar, barprog: progress })[id],
    }
    const context = vm.createContext({
      document,
      T: (en, ja) => language === 'ja' ? ja : en,
      el: (tag, cls, text) => new Element(tag, cls, text),
      html: (tag, cls, text) => new Element(tag, cls, text),
      clean: value => String(value ?? '').replace(/\s+/g, ' ').trim(),
      isConditionallyVisible: () => true,
      questionNumber: () => 10,
      setCardInvalid() {}, showSubmitMessage() {}, revealCard() {},
      text: (en, ja) => language === 'ja' ? ja : en,
      HTMLSelectElement: class {},
    })
    vm.runInContext([
      between(html, 'function mkInput(', 'function upsell('),
      between(html, 'function inputsIn(', 'function save('),
      between(html, 'function refresh()', 'function wirePartySize('),
      between(integration, '  function selectedControlText(', '  function serializeInterests('),
      between(integration, '  function requiredCardComplete(', '  function setCardInvalid('),
      between(integration, '  function validateBeforeSubmit()', '  function fileFingerprint('),
    ].join('\n'), context)
    card = context.question(field, 10, instance, true)
    // The browser parses this marker from the renderer's innerHTML.
    card.appendChild(new Element('span', 'must', 'required'))
    const controls = card.querySelectorAll('input,select,textarea')
    assert.equal(controls.length, 3)
    assert.deepEqual(controls.map(control => control.dataset.k), [0, 1, 2].map(i => `q10${instance ? `_p${instance}` : ''}_${i}`))
    assert.deepEqual(controls.map(control => control.attributes['aria-required']), ['true', 'true', 'false'])
    assert.equal(controls[2].placeholder, language === 'ja' ? '任意' : 'Optional')
    const cases = [
      ['Peter', 'Hansen', '', true],
      ['Søren', 'Jørgensen', '', true],
      ['Anne-Marie', "O’Neill", '', true],
      ['太郎', '山田', '', true],
      ['Peter', 'Hansen', 'Erik', true],
      ['Peter', 'Hansen', '   ', true],
      ['', 'Hansen', 'Erik', false],
      ['Peter', '', 'Erik', false],
      ['   ', 'Hansen', '', false],
      ['', '', 'Erik', false],
    ]
    for (const [first, last, middle, expected] of cases) {
      controls.forEach((control, i) => { control.value = [first, last, middle][i] })
      assert.equal(context.requiredCardComplete(card), expected)
      assert.equal(context.validateBeforeSubmit(), expected)
      context.refresh()
      assert.equal(count.textContent, expected ? '1/1' : '0/1')
      checks++
    }
    controls.forEach((control, i) => { control.value = ['Søren', 'Jørgensen', ''][i] })
    assert.equal(context.serializeQuestionCard(card), language === 'en'
      ? 'First name: Søren\nLast name(s): Jørgensen'
      : '名: Søren\n姓: Jørgensen')
    agree.checked = false
    assert.equal(context.validateBeforeSubmit(), false)
    const otherRow = context.question({ t: 'row', r: 1, cells: [['First'], ['Last']] }, 1, 0, false)
    otherRow.querySelectorAll('input')[0].value = 'Peter'
    assert.equal(context.requiredCardComplete(otherRow), false)
  }
}
assert.match(html, /const STORE="flattravel_intake_v2"/)
assert.match(html, /post-order-survey\.js\?v=20261010-2/)
console.log(`POST_ORDER_NAME_REGRESSION_OK cases=${checks} languages=2 traveller_instances=3 submit_gate=passed progress=passed serialization=unchanged consent=required`)
