# NexaSphere Intelligence — BuildFest Upgrade

## What changed

### 1. Voice agent
- Microphone button in the ask bar.
- Browser speech recognition converts spoken questions into text.
- The assistant automatically reads its answer aloud using speech synthesis.
- Voice input gracefully disables itself where the browser does not support SpeechRecognition.

### 2. Smarter multi-turn assistant
- Conversation history is retained for the current page session.
- Follow-ups such as “why?”, “what about the worst one?”, and “compare that with Lagos” are sent to the reasoning layer with the latest evidence bundle.
- The model is explicitly told that the current computed evidence outranks conversational assumptions.

### 3. More analytics without fabricating raw data
New deterministic derived views:
- return reasons and share of returns
- product-category performance
- customer value by the supplied New/Repeat segmentation
- sales-agent performance
- explicit data-coverage metadata

These are derived from the supplied transaction/dimension data; no new raw business facts were invented.

### 4. Data transparency
A Data Coverage panel now tells the judge what the dataset can and cannot support. In particular:
- customer segmentation is only New vs Repeat
- inventory is monthly store/category rather than SKU-level
- employee analysis is sales-agent performance, without labour cost/hours
- campaign ROI uses the workbook’s attribution
- observed patterns are not treated as causal proof

## Important competition point
The supplied dataset is not actually empty: it contains 16,733 transaction rows plus product, store, employee, campaign, inventory, marketing and target tables. It can answer the nine suggested questions at a useful level. However, several questions are only partially covered at the depth a real BI system would normally provide. The upgrade makes those boundaries visible instead of silently inventing data.

## Verification
`node scripts/selftest.js` → 102 passed, 0 failed.

## V3 — Growth Advisor + Employee Intelligence

- Added an employee command centre with role, team, store, sales activity, revenue, contribution profit, margin, returns, target attainment, primary category/channel and a transparent 50/50 revenue+profit balanced index.
- Employee questions can now resolve named employees directly (e.g. "Tell me about Aisha Afolabi") and "show me each employee" returns all employee profiles, including staff whose role is not measurable through the supplied sales-agent data.
- Added deterministic strategy fallback for growth/profit questions. It prioritises discovered profit leaks, then identifies high-performing sales practices to replicate.
- Expanded the LLM system role into a cross-functional growth advisor while preserving the hard numeric evidence guard and explicit data-limitations policy.
- Added growth and employee starter questions to the UI.


## Claude connection fix
- The live app now calls the Netlify Function directly instead of relying on an unconfigured `/api/analyse` route.
- Added `/api/analyse` and `/api/health` redirects as compatibility routes.
- Added a real Anthropic model health check using `GET /v1/models/{model_id}` before showing `Claude connected`.
- Default model is `claude-sonnet-5`; `ANTHROPIC_MODEL` may override it.
- The assistant never falls back to programmed answers.
- Answers are never spoken automatically; speech is only triggered by the `Speak answer` button.


## Dual-provider fallback
Set NVIDIA_API_KEY in Netlify to enable automatic NVIDIA fallback when Claude is unavailable. Optional NVIDIA_MODEL defaults to nvidia/nemotron-3-super-120b-a12b. Claude remains primary.
