if (!process.argv.some((argument) => argument.startsWith('--area='))) {
  process.argv.push('--area=tokyo')
}
await import('./register-transport-survey-forms.mjs')
