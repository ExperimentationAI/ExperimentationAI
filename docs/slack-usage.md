# ExperimentationAI Slack Bot

## Setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From a manifest**
2. Pick your workspace, paste the contents of `slack-manifest.yaml` from this repo, and create
3. Under **Basic Information** → **App-Level Tokens**, generate a token with the `connections:write` scope — this is your `SLACK_APP_TOKEN` (starts with `xapp-`)
4. Under **Install App**, install to your workspace and copy the **Bot User OAuth Token** — this is your `SLACK_BOT_TOKEN` (starts with `xoxb-`)
5. Under **Basic Information** → **App Credentials**, copy the **Signing Secret** — this is your `SLACK_SIGNING_SECRET`
6. Add all three to your `.env`:
   ```
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_SIGNING_SECRET=...
   SLACK_APP_TOKEN=xapp-...
   SLACK_PORT=3000
   ```
7. `npm run slack`

No ngrok or public URL needed — the bot uses Socket Mode (outbound WebSocket).

## Interacting with the bot

There are two ways to talk to ExperimentationAI:

1. **@mention in a channel** -- invite the bot to a channel, then `@ExperimentationAI analyze my-experiment`
2. **Direct message** -- open a DM with the bot and type commands directly (no @mention needed)

All replies are threaded so they don't clutter the channel.

## Commands

### Analyze an experiment

Run a one-time analysis and get results posted back in-thread.

```
@ExperimentationAI analyze pricing-duration-test
@ExperimentationAI check my-experiment
@ExperimentationAI review onboarding-flow-v2
```

Trigger words: `analyze`, `analyse`, `check`, `review`, `evaluate`

### Monitor an experiment

Set up recurring analysis on a schedule. The bot posts updates in the same thread and auto-stops when it reaches a terminal verdict (ship or kill).

```
@ExperimentationAI monitor pricing-duration-test
@ExperimentationAI monitor pricing-duration-test every 2 hours
@ExperimentationAI monitor onboarding-flow-v2 every weekday
@ExperimentationAI watch my-experiment at daily at 3pm
```

Default schedule is daily at 9am if you don't specify one.

Supported schedule expressions:
| Expression | Cron |
|---|---|
| `every 2 hours` | `0 */2 * * *` |
| `hourly` | `0 * * * *` |
| `daily` / `every day` | `0 9 * * *` |
| `daily at 3pm` | `0 15 * * *` |
| `twice a day` | `0 9,21 * * *` |
| `weekdays` | `0 9 * * 1-5` |
| `weekly` | `0 9 * * 1` |

Trigger words: `monitor`, `watch`, `track`

### Stop monitoring

```
@ExperimentationAI stop pricing-duration-test
@ExperimentationAI cancel my-experiment
@ExperimentationAI unwatch onboarding-flow-v2
```

Trigger words: `stop`, `unwatch`, `unmonitor`, `cancel`

### Check status

List all experiments currently being monitored.

```
@ExperimentationAI status
@ExperimentationAI list
@ExperimentationAI what's watched
```

### Help

```
@ExperimentationAI help
```

## Natural language

If you don't use an exact command, the bot falls back to an LLM to parse your intent. These all work:

```
@ExperimentationAI how's the pricing test doing?
@ExperimentationAI can you take a look at experiment onboarding-v3?
@ExperimentationAI keep an eye on checkout-flow and tell me every morning
@ExperimentationAI stop watching the pricing test
```

## What you get back

Analysis results include:
- **Verdict badge** -- ship (green), kill (red), keep running (yellow)
- **Statistical results** -- p-values, effect sizes, confidence intervals for each metric tested
- **Written conclusion** -- plain-English summary of what the data shows
- **Timestamp and phase** -- when the analysis ran and what phase the experiment is in
