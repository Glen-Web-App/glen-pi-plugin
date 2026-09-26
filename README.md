> **Generated repository.** Source of truth: the glen monorepo (`packages/pi-plugin`). Do not open PRs here.

# glen — Pi plugin

Shared team memory for coding agents. Glen automatically recalls relevant context at
the start of every turn and captures what you build, so your whole team's agents share
the same institutional knowledge.

## What it does

This package is a [pi](https://pi.dev) package: it ships the glen extension
(`extensions/glen.ts`) plus the glen skills. Pi has no declarative hooks file — the
extension subscribes to pi's lifecycle events and runs one frozen `glen` CLI command
per event (the same thin-hook model as glen's Claude Code and Codex plugins):

- **`session_start`** → `glen session-start --agent pi` — surfaces org/mode status
  and queues the review-link instruction.
- **`before_agent_start`** → `glen ingest --agent pi` — sends the prompt (plus the
  prior assistant turn and workspace context: repo, branch, agent name) to your glen
  org, retrieves matching memories, and injects them as context for the model.
- **`agent_settled`** → `glen ingest --agent pi` — captures the completed turn
  (your prompt + the final assistant answer) into team memory.
- **`tool_result` (bash)** → `glen pr-link --agent pi` — after a `git commit`, links
  the commit to the session in glen; when a shell command surfaced a GitHub PR URL,
  appends the matching Glen review link so the agent can share it.

Every command is fail-open: a glen outage can never block or break a pi session.
`glen off` injects and records nothing. In incognito (`glen incognito`) recall still
works but nothing is recorded to team memory. Glen reads only the hook input, the
agent's session transcript, and git metadata for the current repo.

## Skills

The package ships the full glen skill set (search, setup, controls, invite, forget,
code-search, create-skill, use-skill, create-artifact, use-artifact,
import-transcripts, feedback, session-takeover). Pi supports the Agent Skills standard, so they are available as
`/skill:<name>` and are offered to the agent automatically.

## Install

1. Install the glen CLI (the extension shells out to it):

   ```bash
   npm install -g @tryglen/cli
   glen login
   ```

2. Register the package with pi:

   ```bash
   glen install
   ```

   `glen install` detects pi and runs
   `pi install git:github.com/Glen-Web-App/glen-pi-plugin` for you. Restart pi (or
   run `/reload`) to load the extension.

Manual alternative:

```bash
pi install git:github.com/Glen-Web-App/glen-pi-plugin
```

After login your active organization is saved locally. Switch orgs at any time with
`glen org switch`.

## Updating

```sh
pi update git:github.com/Glen-Web-App/glen-pi-plugin
```

Glen also refreshes the package automatically: the `session_start` hook runs a
background `glen doctor --auto`, which spawns the `pi update` above whenever pi and
the package are installed. To update the glen CLI itself:

```sh
glen update
```

`glen update` updates the CLI **and** any installed glen plugins (this package
included) in one go.

## Uninstall

```bash
glen uninstall
```

This also runs `pi remove git:github.com/Glen-Web-App/glen-pi-plugin` for you.

## What data is sent

On every turn, glen sends to your glen org:

- The current user prompt
- The prior assistant turn
- Workspace metadata: repo name, branch, commit hash, remote URL
- Agent name (`pi`) and session details

**Nothing is recorded while incognito is on.** Recall still works — glen fetches
relevant memories but writes nothing to team memory. Admin analytics still count your
prompts as numbers only. Toggle with `glen incognito` / `glen on`. `glen off` injects
and records nothing.

Glen never sends data to any third party. All memory is stored in your org's private
glen instance.

## Troubleshooting

**Check session status (org, mode):**

```sh
glen status
```

**Full diagnostics:**

```sh
glen doctor
```

**Broken setup?** Ask the agent to "set up glen" — the bundled setup skill runs
`glen doctor` and fixes whatever it reports.

**Extension not loading:** run `/reload` inside pi, or restart pi. Verify the package
is registered with `pi list` (it should include
`git:github.com/Glen-Web-App/glen-pi-plugin`).

**No active organization error:** run `glen org switch` to select an org, or
`glen org list` to see your memberships. If the list itself fails with an auth error,
run `glen login` to reconnect.

---

> **Note:** This repository is generated from the
> [glen monorepo](https://github.com/Glen-Web-App/glen) (`packages/pi-plugin`).
> Please open pull requests and issues there, not here.
