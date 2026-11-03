export type IssueStatus = 'pending' | 'in_progress' | 'done'

export type Issue = {
  number: number
  repo?: string
  title?: string
  url?: string
  status: IssueStatus
  // A short word from the agent: the PR, why it is stuck, what is left.
  note?: string
  // When it was added, and when its status last changed.
  added: number
  changed: number
}

declare module 'claude-code' {
  interface PluginState {
    'current-issue': { issues: Shaped<Issue[]> }
  }
}
