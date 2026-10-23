# Usage, quotas, and account resets

Read native OMP totals separately from provider quotas, account credits, and subscription information. Configure accounts in [Models and providers](models-and-providers.md).

## Contents

- [Native OMP statistics](#native-omp-statistics)
- [Zhipu Coding Plan](#zhipu-coding-plan)
- [Claude official accounts](#claude-official-accounts)
- [Codex accounts](#codex-accounts)

For the selected host, **Settings → Usage** includes native OMP `/stats`, provider quotas/balances, Codex subscription/reset cards, and Claude limit-reset controls beside the affected account. Native totals and provider quotas are never added together. Reset actions require confirmation; changing account login or order remains in **Providers**.

## Native OMP statistics

The Usage view reads OMP's native `stats.db` for the resolved host/profile, across projects rather than only Desktop-created agents. Before an uncached read or refresh, Desktop runs the configured OMP's `stats --summary` to synchronize its local index, using the same environment and profile. This performs native transcript indexing, not model requests; Desktop receives numeric aggregates and never exposes prompts, transcript paths, credentials, CLI output, or raw database errors. Labels/explanations follow the interface language, including Chinese.

Ranges are 1 hour, 24 hours, 7 days, 30 days, 90 days, and all indexed time. Counts, failures, input/output/cache tokens, native total tokens, and API-equivalent USD costs include provider, model, and agent-type breakdowns.

Interpret these values carefully:

- Native total tokens are authoritative. Provider orchestration tokens can make them differ from the four displayed conversation-token buckets.
- Indexed transcript counts are not Desktop conversation counts.
- API-equivalent USD costs are not subscription bills.
- Unpriced requests remain unknown; recorded zero cost remains zero.
- Provider quotas and current-session usage are separate.

Refresh synchronizes the native index and invalidates the host's cached ranges. Concurrent requests share a synchronization only when their scope and invocation match. Only direct OMP commands with no prefix arguments other than `--profile` are eligible; ambiguous wrappers or other flags return scope unavailable instead of executing a possible model request.

Latest indexed-request time and index-read time are shown separately. Missing, unsupported, unreadable, failed-refresh, and timed-out sources are not shown as zero use. Native synchronization has a 40-second deadline with up to 2 seconds waiting for process-tree cleanup; if cleanup cannot finish, the failed flight remains reserved until the writer exits rather than starting another writer. Only a successful synchronization proceeds to the numeric SQLite scan, which runs in a short-lived child with a 15-second deadline, not on the daemon event loop.

## Zhipu Coding Plan

Built-in `zhipu-coding-plan` reuses keys saved through OMP sign-in. Each enabled stored key has its own labeled usage entry, so a rejected key cannot hide another key's quota. No `models.yml` entry is needed for built-in usage.

For a custom China Zhipu provider, configure `baseUrl` (for example `https://open.bigmodel.cn/api/coding/paas/v4`) and `apiKey` in OMP's `models.yml`; Desktop retains its custom name. The sidebar, active-model context tooltip, and Host Settings Usage display reported five-hour, weekly (when present), and MCP/tool-call windows. Both `TOKENS_LIMIT` and `CREDIT_LIMIT` responses are supported.

Zhipu percentages mean **used quota**. Missing percentages stay unknown, not unused, and reset times appear only when returned by the service. Desktop sends the raw API key only to the China service's official-plugin monitor endpoint on `https://open.bigmodel.cn`, without following redirects. This does not support the separate `api.z.ai` service or arbitrary OpenAI-compatible `/v1/usage` endpoints. Lookup failures neither change model availability nor interrupt inference.

## Claude official accounts

OMP's built-in `anthropic` sign-ins have individual entries under **Host Settings → Model providers → Signed-in providers** and host **Usage**. **Claude usage** in the mobile/desktop composer opens the sheet even before context-token data exists. Reopening it or choosing **Refresh** requests fresh server usage.

When a session identifies its selected credential, usage is isolated to that account. Otherwise the sheet explains the missing session account and lists signed-in accounts with their own labels/quotas. It never guesses the active account or merges percentages; account names, notes, and order are unchanged.

### Quota windows and failure states

Five-hour and overall weekly percentages mean **remaining quota**. Model-specific weekly windows appear only when Anthropic reports them; unknown names retain their original identifier rather than guessed Opus/Sonnet labels. Reset dates include timezones. Compact countdown deadlines request new server usage instead of declaring a local reset. Missing percentages/dates remain unknown.

The five-hour row stays visible when usage is unavailable or only a reached flag is known, with no fabricated progress bar. Authentication, network, timeout, invalid-response, and HTTP failures are distinct. An OAuth usage-query retry deadline is not a quota reset.

The daemon retains model-request restrictions for the actual enabled OAuth account across sessions and failed usage reads:

- A generic model 429 is an unknown-window restriction. Five-hour attribution needs explicit native window evidence or a fresh exhausted five-hour observation for the same account.
- Older in-flight reads cannot clear newer restrictions. Deadlines trigger server rechecks, not local recovery claims.
- Fresh matching quota data may confirm recovery of a known window. Unknown-window throttling requires a successful model response for that account.
- Desktop never sends a model request or redeems a reset automatically to probe recovery.

These observations are daemon-local memory, not billing records; restart requires fresh server evidence.

### Extra usage and request privacy

Account and Usage views display read-only **extra usage** status, reported spending, and monthly cap when supplied. OAuth amounts reported in USD cents are converted to dollars. Missing spending is not zero; missing cap is not unlimited. Explicit non-USD or unknown currencies are not labeled USD.

Extra usage is [billed separately from subscription](https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans) and managed at [Claude Settings → Usage](https://claude.ai/settings/usage), not purchased or enabled in Desktop.

Quota reads use Anthropic's undocumented OAuth `/api/oauth/usage?cedar_ember=1`, including reset inventory, and optionally `/api/oauth/profile` for plan metadata. Requests reuse OMP's proxy, bound both request and response-body read, and never follow redirects. Profile failure does not discard retrieved usage. Authorization/service errors expose no credentials, refresh no tokens, and do not modify saved accounts.

### Official limit resets

Claude's [official limit resets](https://support.claude.com/en/articles/17007452-what-is-a-limit-reset), occasionally granted to eligible plans, are distinct from paid extra usage and Codex reset cards. Signed-in provider settings show each account's reported grants, remaining uses, start/expiry, cleared windows, and eligibility. Held uses do not imply redeemability: expired, future, paused, exhausted, cooldown-blocked, or otherwise unusable grants cannot be consumed. Unknown inventory is not zero.

Redemption requires explicit irreversible confirmation naming account, grant, and affected windows. The daemon checks fresh inventory, binds the request to the enabled Claude OAuth account and organization, serializes concurrent redemption per account, and sends one native `POST /api/organizations/{organizationUuid}/reset_rate_limits`. This OAuth contract and client-identification header were checked against first-party Claude CLI **2.1.296**; these endpoints are not a stable public API.

After an attempted redemption, quota and inventory refresh. HTTP 200 alone is not success; non-reset and uncertain outcomes remain distinct. Mutations are not automatically retried. An explicit retry of an uncertain request reuses its native-valid redemption ID rather than creating another intent. Hosts lacking `ompClaudeLimitResets` disable redemption and show update guidance. Grants neither enable paid extra usage nor refund prior spending.

Claude accounts do not show Codex reset actions or subscription-expiry controls. Desktop does not infer a subscription end date from token expiry, subscription creation, grant expiry, or quota reset.

## Codex accounts

### Quota and credits

**Host Settings → Model providers → Signed-in providers** shows each Codex account's five-hour and weekly windows. Windows are identified by reported duration; missing durations retain legacy plan/window mapping. A five-hour window appears only if usage or reset time is reported, including for Pro.

Percentages mean **remaining quota**; unknown is not 100% remaining. Context tooltips list labeled accounts instead of guessing from provider namespace. Settings/sidebar show live compact countdowns such as `3d21h` and `2h12min`; deadlines trigger server refresh and an awaiting-refresh state, never assumed recovery.

**Credits** in host Usage and provider account details preserve the authenticated API's exact decimal balance string without rounding or interpreting it as currency, or display the reported unlimited/disabled state. Missing balances are unavailable, not zero. Credits, five-hour/weekly quota, and banked reset cards are separate. Desktop neither infers a currency nor scrapes ChatGPT browser cookies.

### Reset cards

Each account lists banked cards, server-reported available count, status, and timezone-qualified grant/expiry timestamps. **Use reset card** requires confirmation of account, card, and applicable windows. Only available, unexpired `codex_rate_limits` cards can be submitted.

The daemon rechecks with OpenAI before consumption and preserves the redemption request ID so duplicate submissions do not intentionally spend another card. A confirmed server result refreshes both cards and quota. Errors and already-redeemed/nothing-to-reset outcomes are not reported as successful resets. Older daemons cannot consume cards.

### Subscription validity

Subscription validity is separate from quota reset. Desktop displays a timezone-qualified `chatgpt_subscription_active_until` claim when supplied by the current OAuth credential. Otherwise it queries the official Codex [`/backend-api/wham/accounts/check` account source](https://github.com/openai/codex/blob/a5130128697b10022a88e8f5eae6dca77393b4b0/codex-rs/backend-client/src/client.rs#L398-L407), matching selected account ID, not default workspace. Reported entitlement expiry and live remaining time are labeled separately from token metadata. Neither source guarantees auto-renewal.

OAuth responses may supply only account/plan data: Desktop then says the sign-in does not support expiry lookup. A successful entitlement response with no date says **Subscription expiry unavailable**; HTTP/network/malformed-response/timeout failure says **Could not query subscription expiry** without discarding independently available quotas/cards.

None of those states means absent or expired subscription. **No subscription** requires a reported Free plan or explicit inactive entitlement without expiry. OAuth expiration, quota resets, and fabricated `0` are never substituted.

ChatGPT browser billing has a separate authentication boundary. Desktop does not scrape cookies or send Codex credentials to the old browser-only account endpoint. Check ChatGPT billing settings when the current sign-in provides no date.
