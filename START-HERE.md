# NexaSphere Intelligence — FINAL Claude build

## Deployment
1. Upload this ZIP to Netlify (or connect the repository).
2. In Netlify, add an environment variable:
   - `ANTHROPIC_API_KEY` = your Anthropic API key
   - Optional: `ANTHROPIC_MODEL` = `claude-sonnet-5`
3. Redeploy.

NVIDIA is not required. Nexa uses Anthropic/Claude as its sole reasoning provider in this build.

## Important behaviour
- Claude is the reasoning layer; the application computes the business figures.
- There is no programmed-answer fallback. If Claude is unavailable, Nexa explicitly reports that AI reasoning is unavailable instead of substituting a canned response.
- Answers are never spoken automatically. The user must click **Speak answer**.
- Voice input is only activated by clicking the microphone.
- Employee claims are restricted to supplied employee master data and measurable sales activity. The dataset does not establish outside employment, hours worked, salary, effort, intent, or causal explanations.
- The evidence bundle includes both high- and low-performing employees and the full employee role/profile table so natural questions such as “Who made the least sale?” can be answered from the data.

## Validation
- Self-test: 102/102 passed.
- Build: successful.
