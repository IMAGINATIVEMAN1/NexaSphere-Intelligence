# NexaSphere Intelligence — solo runbook

Everything needed to demo, record and submit **without help**.
AI BuildFest 2026 · Track 1 · Case Study 4 · Participant ID **BF-0968**
Deadline: **Friday 29 August 2026**.

---

## 1. Run it

```bash
cd ~/nexa
node scripts/dev.js
```

<http://localhost:8899>. Stop with `Ctrl-C` or `pkill -f "node scripts/dev.js"`.

**Demo shortcut:** `http://localhost:8899/?q=What%20should%20we%20do%20to%20make%20more%20profit%3F`
asks that question automatically on load — use it so the recorded run is
identical every time.

To use your Anthropic key instead of the free fallback (faster, ~3s instead of
~12s), put it in `~/.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

The server reads `~/.env` on start and prints which providers it found.

---

## 2. Prove it works

```bash
node scripts/selftest.js     # 102 checks
```

Screenshot that output — it is your evidence-of-testing deliverable.

To show the suite actually bites, break something and watch it fail:

```bash
# revenue read from the wrong column
sed -i '' "s/'Realized_Revenue_NGN')/'Net_Sales_NGN')/" lib/kpi.js
node scripts/selftest.js     # 15 failures
git checkout lib/kpi.js 2>/dev/null || sed -i '' "s/'Net_Sales_NGN')/'Realized_Revenue_NGN')/" lib/kpi.js
```

Most submissions have a green suite that cannot fail. Showing yours fail on
demand is worth more than showing it pass.

---

## 3. The three things to say on camera

1. **"Every figure was computed before the model was called."** Then run it with
   the keys stripped and show it still answers.
2. **"The test values were computed independently in Python from the original
   spreadsheet."** Two implementations agreeing to the kobo on ₦11.8bn.
3. **"The ₦13.88bn of overstock is working capital, not profit — so it is not
   added to the recoverable total."** Volunteering that distinction is what
   separates analysis from a sales pitch.

---

## 4. Record the demo

**Record it. Do not present live.** A recording cannot fail.

| Time | Show | Say |
|---|---|---|
| 0:00–0:25 | The opening screen | "Revenue is growing. Profit is not. This assistant found eight reasons why, worth ₦2.23 billion." |
| 0:25–1:15 | Ask "What should we do to make more profit?" | Read the prioritised answer. Point at the trace line. |
| 1:15–1:50 | Open the marketing finding | "₦997m spent, ₦369m of profit. Thirteen of fourteen campaigns lost money." |
| 1:50–2:20 | The margin-by-month chart | "The two thinnest margins are both November. That is Black Friday. Growth is being bought." |
| 2:20–2:50 | `node scripts/selftest.js`, then break it | 102 passing, then 15 failing on demand. |
| 2:50–3:10 | Run with no API keys | "No model. It still answers." |

Record with QuickTime (⌘⇧5) or OBS. Browser at ~1440px wide so the two-pane
layout shows properly.

---

## 5. Submission checklist

Submit with Participant ID **BF-0968** before Friday 29 August.

| Deliverable | Where |
|---|---|
| Explanation of the problem | `docs/SUBMISSION.md` §1 |
| Functional prototype | the app + your recording |
| Workflow explanation | `docs/SUBMISSION.md` §2 |
| Tools / models used | `docs/SUBMISSION.md` §7 |
| KPIs and insights | the app; `docs/SUBMISSION.md` §4 |
| At least three findings | eight of them |
| Practical recommendations | every finding carries one |
| Evidence of testing | `node scripts/selftest.js` output |
| Limitations | `docs/SUBMISSION.md` §8 |
| Demo / presentation | your recording |

**Upload the video to Google Drive or YouTube unlisted and check the sharing
setting.** A permission-locked video scores zero, and it is the commonest way
people lose.

---

## 6. If something breaks an hour before submission

| Symptom | Fix |
|---|---|
| Page blank | Check the terminal for a 404 on `/lib/...`. You must run from `~/nexa`. |
| "dataset failed to load" | `python3 scripts/build-data.py` to regenerate `data/nexasphere.json`. |
| Answers are blunt / no prose | The model was unreachable. Expected behaviour, not a bug — say so. |
| Answers take 15 seconds | The free NVIDIA model. Add an Anthropic key to `~/.env` for ~3s. |
| A figure looks wrong | `node scripts/selftest.js`. Green means the engine agrees with the independent Python reference. |
| Charts overlap on a small screen | The layout collapses to one column below 1080px. Record at 1440px. |

**Rule for the last hour: stop adding things.** A working submission of what
exists beats a broken submission of something better.


### AI providers
- `ANTHROPIC_API_KEY` is the primary provider secret.
- `NVIDIA_API_KEY` is optional automatic fallback; NVIDIA hosted API uses `https://integrate.api.nvidia.com/v1/chat/completions`.
- Optional `NVIDIA_MODEL`; default `nvidia/nemotron-3-super-120b-a12b`.
- The browser never receives either secret.
