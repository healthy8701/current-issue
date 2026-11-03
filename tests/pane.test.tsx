import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'current-issue',
  component: 'Pane',
  requestId: 'current-issue',
  props: {
    title: 'Issue 進度',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const engine = (on: Parameters<Parameters<typeof test>[1]>[1]) => {
  on('command.register', () => ({ value: { command: 'issue' } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__current-issue__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/' }))
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: '', signal: null },
  }))
}

test('a queue moves from pending to in progress to done, on every surface', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const empty = await $.ui.mount({ ...PANE, surface })
    expect((await empty.find({ type: 'Text', text: /沒有/ }))?.text).toBe('目前沒有指派的 issue。')
    await empty.unmount()

    await $.tool.call({
      tool: 'mcp__current-issue__add_issues',
      issues: [
        { number: 1, repo: 'acme/app', title: 'One', url: 'https://github.com/acme/app/issues/1' },
        { number: 2, repo: 'acme/app', title: 'Two', url: 'https://github.com/acme/app/issues/2' },
        { number: 3, repo: 'acme/app', title: 'Three', url: 'https://github.com/acme/app/issues/3' },
      ],
    })
    await $.tool.call({ tool: 'mcp__current-issue__set_issue_status', number: 1, status: 'done', note: 'PR #9' })
    await $.tool.call({ tool: 'mcp__current-issue__set_issue_status', number: 2, status: 'in_progress' })

    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /進度/ }))?.text).toBe('進度 1/3 已解決')
    expect((await ui.find({ type: 'Text', text: /正在解決/ }))?.text).toBe('▶ 正在解決 (1)')
    expect((await ui.find({ type: 'Text', text: /待解決/ }))?.text).toBe('○ 待解決 (1)')
    expect((await ui.find({ type: 'Text', text: /已解決 \(/ }))?.text).toBe('✓ 已解決 (1)')
    expect((await ui.find({ type: 'Text', text: /PR #9/ }))?.text).toContain('PR #9')

    await ui.press({ key: 'clear' })
    expect((await ui.find({ type: 'Text', text: /沒有/ }))?.text).toBe('目前沒有指派的 issue。')
    await ui.unmount()
  }
})

test('a status for an unlisted issue adds it', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__current-issue__set_issue_status', number: 5, title: 'Five', status: 'in_progress' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Five/ }))?.text).toContain('#5')
  expect((await ui.find({ type: 'Text', text: /進度/ }))?.text).toBe('進度 0/1 已解決')
  await ui.unmount()
})

const BAND = {
  plugin: 'current-issue',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('the band is one row of progress, and nothing with no issues', async ($, on) => {
  engine(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const empty = await $.ui.mount({ ...BAND, surface })
    expect((await empty.find({ type: 'Text' }))?.text).toBe('engine')
    await empty.unmount()

    await $.tool.call({ tool: 'mcp__current-issue__add_issues', issues: [1, 2, 3, 4] })
    await $.tool.call({ tool: 'mcp__current-issue__set_issue_status', number: 1, status: 'done' })
    await $.tool.call({ tool: 'mcp__current-issue__set_issue_status', number: 2, title: 'Fix login', status: 'in_progress' })

    const ui = await $.ui.mount({ ...BAND, surface })
    const row = (await ui.find({ type: 'Text', text: /Issue 1\/4/ }))?.text
    expect(row).toContain('▶ #2 Fix login')
    expect(row).toContain('待解決 2')
    await ui.unmount()
    await $.tool.call({ tool: 'mcp__current-issue__clear_issues' })
  }
})
