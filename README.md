# current-issue

A Claude Code mod that tracks the GitHub issues you hand an agent: which one it is solving now, which are still pending, and which are done.

A single row above the prompt shows the progress (`Issue 3/10 · ▶ #12 Fix login · 待解決 6`); its 詳細 button, or `/issue`, opens a pane with the full list sorted into 正在解決, 待解決 and 已解決, each issue linked to GitHub, with the agent's note (such as the PR).

The agent reports its progress itself: the mod adds a line to the system prompt asking it to call `add_issues` with every issue it is given, then `set_issue_status` as it starts and resolves each. Nothing is guessed from messages, commands or branches. With no issues, the row is hidden.

Commands: `/issue` opens the pane, `/issue clear` empties the list.

## Install

At the prompt of a terminal session:

```
/plugin install current-issue --marketplace healthy8701/current-issue
```

Answer `y` to add the marketplace, then pick a scope (user, so it loads in every session).

From a shell:

```
claude plugin install current-issue --marketplace healthy8701/current-issue
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `healthy8701/current-issue`, then Add plugin.
