import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Issue, IssueStatus } from '../types'

const PANE = 'current-issue'
const TITLE = 'Issue 進度'
const TOOL = 'mcp__current-issue__'
// Change the tag when Issue's fields change: it declines what an earlier
// version stored, which outlives a reload.
const issues = atom({ plugin: 'current-issue', key: 'issues' } as const, [], {
  shape: 'issues-1',
})

const STATUSES: readonly IssueStatus[] = ['pending', 'in_progress', 'done']
const ISSUE_REF = {
  number: { type: 'integer', description: 'Issue number' },
  repo: { type: 'string', description: 'owner/name, if known' },
  title: { type: 'string', description: 'Issue title, if known' },
  url: { type: 'string', description: 'Issue URL, if known' },
}

type IssueRef = { number: number; repo?: string; title?: string; url?: string }

const issueUrl = (repo: string | undefined, n: number) =>
  repo ? `https://github.com/${repo}/issues/${n}` : undefined

// The same issue: its number, and its repo where both sides name one.
const same = (a: IssueRef, b: IssueRef) =>
  a.number === b.number && (!a.repo || !b.repo || a.repo === b.repo)

async function originRepo($: EngineInterface): Promise<string | undefined> {
  try {
    const { exitCode, stdout } = await $.process.run(
      ['git', 'remote', 'get-url', 'origin'],
      { cwd: await $.session.cwd(), timeoutMs: 5000 },
    )
    if (exitCode !== 0) return undefined
    const m = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\s*$/.exec(stdout)

    return m?.[1]
  } catch {
    return undefined
  }
}

// Fill in the repo, title and URL with git and gh for issues that came with
// only a number; one at a time, after the tool has answered.
async function enrich($: EngineInterface, refs: readonly IssueRef[]) {
  const origin = refs.some(r => !r.repo) ? await originRepo($) : undefined
  for (const ref of refs) {
    const repo = ref.repo ?? origin
    let { title, url } = ref
    if (!title) {
      try {
        const argv = ['gh', 'issue', 'view', String(ref.number), '--json', 'title,url']
        if (repo) argv.push('--repo', repo)
        const { exitCode, stdout } = await $.process.run(argv, {
          cwd: await $.session.cwd(),
          timeoutMs: 8000,
        })
        if (exitCode === 0) {
          const json = JSON.parse(stdout) as { title?: string; url?: string }
          title = json.title
          url = url ?? json.url
        }
      } catch {
        // No gh, no network, no auth: the number is still worth showing.
      }
    }
    url = url ?? issueUrl(repo, ref.number)
    await update($, issues, list =>
      list.map(one =>
        same(one, ref)
          ? { ...one, repo: one.repo ?? repo, title: one.title ?? title, url: one.url ?? url }
          : one,
      ),
    )
  }
}

// Adds what is new, updates what is there; a given status overrides.
async function upsert(
  $: EngineInterface,
  refs: readonly IssueRef[],
  status?: IssueStatus,
  note?: string,
) {
  const now = Date.now()
  await update($, issues, list => {
    let next = [...list]
    for (const ref of refs) {
      const i = next.findIndex(one => same(one, ref))
      const old = next[i]
      if (old) {
        next[i] = {
          ...old,
          repo: ref.repo ?? old.repo,
          title: ref.title ?? old.title,
          url: ref.url ?? old.url,
          status: status ?? old.status,
          note: note ?? (status && status !== old.status ? undefined : old.note),
          changed: status && status !== old.status ? now : old.changed,
        }
      } else {
        next = [...next, { ...ref, status: status ?? 'pending', note, added: now, changed: now }]
      }
    }

    return next.slice(-200)
  })
  await showStatus($)
  void enrich($, refs.filter(r => !r.title || !r.repo))
}

async function showStatus($: EngineInterface) {
  const list = await read($, issues)
  if (list.length === 0) {
    $.ui.status(undefined)
    return
  }
  const done = list.filter(i => i.status === 'done').length
  const working = list.filter(i => i.status === 'in_progress').map(i => `#${i.number}`)
  $.ui.status(
    `Issue ${done}/${list.length}` + (working.length ? ` · 處理中 ${working.join(' ')}` : ''),
  )
}

const refsOf = (input: unknown): IssueRef[] => {
  const list = (input as { issues?: unknown }).issues
  if (!Array.isArray(list)) return []

  return list.flatMap(raw => {
    const one = (typeof raw === 'number' ? { number: raw } : raw) as Partial<IssueRef> | null
    const n = Number(one?.number)
    return Number.isInteger(n) && n > 0
      ? [{ number: n, repo: one?.repo, title: one?.title, url: one?.url }]
      : []
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'issue',
      description: '顯示 issue 進度面板；/issue clear 清空',
    })
    await $.tool.register({
      name: 'add_issues',
      description:
        'Put GitHub issues in the person\'s "issue progress" pane, as pending. Call it once with every issue you are assigned, before starting the first.',
      inputSchema: {
        type: 'object',
        properties: {
          issues: {
            type: 'array',
            items: { type: 'object', properties: ISSUE_REF, required: ['number'] },
          },
        },
        required: ['issues'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'set_issue_status',
      description:
        'Move one issue in the "issue progress" pane to in_progress when you start it, done when it is resolved, or back to pending. Adds the issue if it is not listed. `note` is a few words the person sees (a PR link, why it is blocked).',
      inputSchema: {
        type: 'object',
        properties: {
          ...ISSUE_REF,
          status: { type: 'string', enum: STATUSES },
          note: { type: 'string', description: 'A few words shown under the issue' },
        },
        required: ['number', 'status'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'clear_issues',
      description: 'Empty the "issue progress" pane. Only when the person asks.',
      isDeferred: false,
    })
    return next(e)
  })

  // The agent reports its progress itself: tell it when to.
  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)

    return {
      sections: [
        ...sections,
        {
          id: 'current-issue:report',
          scope: 'session',
          text: `The person follows your GitHub issue work in an "issue progress" row above the prompt (and a pane on demand), sorted into in progress, pending and done. When you are given issues to work on, first call ${TOOL}add_issues with all of them. When you start one, call ${TOOL}set_issue_status with status in_progress; when it is resolved, status done (a note such as the PR link helps); if you set it aside, back to pending with a note why. Keep the pane true to what you are doing at every moment.`,
        },
      ],
    }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'issue' }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      await update($, issues, () => [])
      await showStatus($)
      return { text: '已清空 issue 進度。' }
    }
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: '已開啟 issue 進度面板。' }
  })

  on('tool.call', { tool: 'mcp__current-issue__add_issues' }, async ($, e) => {
    const refs = refsOf(e)
    if (refs.length === 0) {
      return { result: 'No issues given: pass issues: [{ number, ... }].', isError: true }
    }
    await upsert($, refs)
    const list = await read($, issues)

    return { result: `Pane lists ${list.length} issues (${refs.length} given).` }
  }).catch(() => ({ result: 'current-issue: could not update the pane.', isError: true }))

  on('tool.call', { tool: 'mcp__current-issue__set_issue_status' }, async ($, e) => {
    const input = e as unknown as IssueRef & { status?: string; note?: string }
    const status = STATUSES.find(s => s === input.status)
    const n = Number(input.number)
    if (!status || !Number.isInteger(n)) {
      return { result: 'Give number and status (pending, in_progress or done).', isError: true }
    }
    await upsert(
      $,
      [{ number: n, repo: input.repo, title: input.title, url: input.url }],
      status,
      input.note,
    )

    return { result: `#${n} is now ${status}.` }
  }).catch(() => ({ result: 'current-issue: could not update the pane.', isError: true }))

  on('tool.call', { tool: 'mcp__current-issue__clear_issues' }, async $ => {
    await update($, issues, () => [])
    await showStatus($)

    return { result: 'Issue pane emptied.' }
  }).catch(() => ({ result: 'current-issue: could not update the pane.', isError: true }))

  // One row above the prompt; the full list is the pane, opened on demand.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, issues)
    if (list.length === 0 || e.props.hasSurvey) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const done = list.filter(i => i.status === 'done').length
    const pending = list.filter(i => i.status === 'pending').length
    const working = list.filter(i => i.status === 'in_progress')
    const first = working[0]
    const now = first
      ? `▶ #${first.number} ${first.title ?? ''}`.trim() +
        (working.length > 1 ? ` +${working.length - 1}` : '')
      : '目前沒有正在解決的'
    const room = Math.max(20, e.props.bodyColumns - 34)
    const shown = now.length > room ? `${now.slice(0, room - 1)}…` : now

    return (
      <Box>
        <Text>
          <Text bold>Issue {done}/{list.length}</Text>
          <Text dimColor> · </Text>
          {shown}
          <Text dimColor> · 待解決 {pending} </Text>
        </Text>
        <Button
          key="details"
          label="詳細"
          onPress={() => $.ui.open({ id: PANE, title: TITLE })}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Link, Button } = $.ui.resolve(e)
    const list = await read($, issues)

    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>目前沒有指派的 issue。</Text>
          <Text dimColor>指派 issue 給 agent 後，這裡會顯示正在解決、待解決和已解決。</Text>
        </Box>
      )
    }

    const done = list.filter(i => i.status === 'done')
    const groups: { status: IssueStatus; label: string; items: Issue[] }[] = [
      { status: 'in_progress', label: '▶ 正在解決', items: list.filter(i => i.status === 'in_progress') },
      { status: 'pending', label: '○ 待解決', items: list.filter(i => i.status === 'pending') },
      // Most recently resolved first.
      { status: 'done', label: '✓ 已解決', items: [...done].sort((a, b) => b.changed - a.changed) },
    ]
    const repos = new Set(list.map(i => i.repo).filter(Boolean))
    const showRepo = repos.size > 1

    return (
      <Box flexDirection="column">
        <Text bold>
          進度 {done.length}/{list.length} 已解決
        </Text>
        {repos.size === 1 && <Text dimColor>{[...repos][0]}</Text>}
        {groups.map(group => (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>
              {group.label} ({group.items.length})
            </Text>
            {group.items.length === 0 && <Text dimColor>  無</Text>}
            {group.items.map(item => (
              <Box flexDirection="column">
                <Text dimColor={group.status === 'done'} bold={group.status === 'in_progress'}>
                  {'  '}
                  {item.url ? <Link href={item.url}>#{item.number}</Link> : `#${item.number}`}{' '}
                  {item.title ?? ''}
                  {showRepo && item.repo ? ` (${item.repo})` : ''}
                </Text>
                {item.note && <Text dimColor>    {item.note}</Text>}
              </Box>
            ))}
          </Box>
        ))}
        <Box marginTop={1}>
          <Button
            key="clear"
            label="清空"
            onPress={async () => {
              await update($, issues, () => [])
              await showStatus($)
            }}
          />
        </Box>
      </Box>
    )
  })
}
