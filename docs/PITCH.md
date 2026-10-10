# FluSentinel: pitch, demo and Q&A notes

Every number below is on the site. Most are under "Why trust it"; the cluster counts and the costs are under "Who this is for", the record date under "Track record", and the week numbers on the date line. Do not say a number that is not there. Always say the unit: weeks, rises, records.

## Pitch (3 minutes, no software on screen; the timings add up to 180 seconds)
1. **Hook (20 s).** In one week of October 2025, influenza clusters in Malaysia went from 14 to 97, and 43 of them were in Selangor. (Ministry of Health statement, reported by Bernama, 9 Oct 2025.)
2. **Problem (30 s).** The only public weekly lab series, WHO FluNet, was about four weeks behind when we checked on 10 October 2026. During the 2025 surge the Ministry issued statements faster, but as one-off statements, not a series a planner can track. For scale: one admission for severe respiratory infection costs about MYR 3,900 to 5,400. We do not claim the tool would have avoided any.
3. **What we built (35 s).** A ladder with four steps. Clear, Watch and Warning come from a machine-learning classifier that reads the national lab series and speaks about the four weeks public data has not reached yet; it looks ahead only when given current counts. Outbreak comes from a fixed rule on the newest data a planner uploads. Each step has its own actions: free checks at Watch, preparation at Warning, the costly response only at Outbreak. Each step shows why.
4. **Proof (45 s).**
   - Six past years, each year scored by a model trained only on earlier years. Of 120 weeks that were followed by a rapid rise, 109 were in Watch or Warning.
   - When it said Clear, a rise followed in 11 of 95 weeks. When it said Warning, in 91 of 133.
   - Early: of 44 weeks where the rise had not yet met our definition, 41 were already in Watch or Warning.
   - Before each of the three times positivity crossed the alert line since 2022, the classifier had been at Warning for 7, 13 and 4 weeks in a row. The reverse does not hold: of 23 Warning periods, 3 led to a crossing.
   - With current data the Outbreak rule fired in the week the 2025 surge crossed the line. With public data, four weeks later.
   - What did not work: forecasting the exact level was no better than "same as last week", so we do not show it as a forecast. We show that result.
5. **Honest limits (25 s).** The skill is modest: Watch or higher is on in 66% of weeks, and always warning would be right 43% of the time. The years are uneven: in 2023 only 8 of 26 Warning weeks were followed by a rise. One surge for the Outbreak rule. A national signal, not a district one. No user has tested it. The six years (2019 and 2022 to August 2026) are a back-test, not a clean test: the Watch cut-off was chosen with them in view.
6. **So we have started scoring ourselves on unseen weeks (15 s).** One claim so far, written down on 10 and 11 October 2026 about four weeks that are not published yet, with a fingerprint of the data and the model. It will be scored when they are. A person runs it each week.
7. **Ask (10 s).** One organisation willing to share weekly lab figures for a pilot. That would test the alert rule on their data and let us build a classifier that does not depend on the size of the lab network.

## Demo (4 minutes, replay link only: `?replay=1`)
1. Date line: public data ends at week 37 of 2025; today is week 41.
2. Alert card: the step is **Warning**, while the alert rule on public data is still **Green**. Read one line of "Why this step".
3. Press **Load those four weeks**. The step moves to **Outbreak**, the type is A(H3), the actions change.
4. Action plan box: show the fixed template. If a key is set, press **Draft with AI**, point at "not approved", then **Approve this plan** with your name.
5. Scroll to **Why trust it**: the six-year chart. Colour ahead of red is a warning that came first; colour with no red after it is a false warning, left in.
6. **Where**: zoom to Selangor; the capacity table uses real beds in operation and 2024 occupancy.
7. **Track record**: the record made before the figures were published.
8. If asked about bad data: press "Reset to public data" first, then load `demo_SIMULATED_bad_file.csv` and show the data warning. (After the four weeks are loaded the checker expects week 42, so the bad file is refused.)
Before the demo: press "Reset to public data" in the replay so it starts at Warning. The four weeks you load are the real national figures; say they stand in for a planner's own lab feed.

## Likely questions
| Question | Answer |
|---|---|
| Where is the AI? | The classifier is the learned model: 150 small decision steps on recent counts. A language model does wording only: it rewords the English summary and drafts the action plan, every number it writes is checked against the computed figures, and a person must approve the plan. It never sets a step or picks an action. |
| Your forecast failed. What is predictive here? | The classifier. It does not predict the level; it sorts each week into a risk band for a rapid rise in the four weeks after the newest data. Of 44 quiet weeks that were followed by a rise, 41 were already in Watch or Warning and 31 in Warning. On public data those four weeks have already happened, so it fills the reporting gap; with current data it looks ahead. |
| 43% of weeks are followed by a rise. Is the recall trivial? | Flagging every week would catch every rise and be right 43% of the time. Watch or higher is right 58% of the time (109 of 187 weeks), Warning 68% (91 of 133), and Clear is wrong 12% of the time (11 of 95), most of them in the low-volume years. The ranking score is 0.82 against 0.75 for three-week growth alone. Real, and modest. |
| Is Watch useful if it is on 66% of the time? | Not as an alarm. It is a risk band. The useful states are Clear, which is rarely wrong, and Warning. That is why Watch only asks for free checks. |
| Did you tune the cut-offs on the test years? | Yes for Watch: 0.40 is the highest cut-off that still flagged 90% of rise weeks across the six years, so those counts describe the past. Picking it each year from earlier years only gave 113 of 120 with 85 false-warning weeks, and that moves by several points with how the pick is made. The cut-offs are now frozen, and only the Track record is a test on unseen weeks. |
| A better model exists; why not use it? | A version without the time-of-year inputs scores better on the six years. Swapping it in after seeing its test results would inflate our numbers, so it runs in shadow in the Track record and future weeks decide. |
| One surge is not evidence. | Correct, for the Outbreak rule. That is why we report counts, not rates, and keep the Track record. |
| Why is this not deployed? | A static copy can be hosted and the model runs in the browser. Shared uploads, passcodes, the AI draft and plan approval need the small Node server, which runs on a laptop today. We spent the time on testing. |
| Why Orange and not Red at 37%? | Red needs the rule's projection to stay high. The projection expected positivity to ease, so the rule said Orange. That projection is the forecast that was no better than a simple guess; the rule still reads it, and we list that as a limit. |
| Who is the user, and have you spoken to one? | The hypothesis is a planner without the Ministry's internal feed: a private hospital group or a state-government planner. We have not spoken to one. That is the first thing a pilot would test. |
| A national signal for Selangor decisions? | The ladder is labelled a national signal and its actions name roles, not districts. The Selangor map and capacity table show where load would fall; they are an illustration, not a district forecast. |
| Are the thresholds official? | No. They are ours, computed from training weeks. |
| Can it run on my own lab's data? | The alert rule can, with your own lines after 52 weeks. The classifier is switched off for an own series: at a tenth of the national volume, 41 of 85 of its calls changed. |
| How do you stop false uploads? | Uploads are checked, logged with who and when, need a passcode when one is set, and can be undone. Nothing is erased. |

## Three questions for a real user (ask one person today)
1. When influenza is rising, what do you decide, and how often?
2. What figures do you look at now, and how old are they when you see them?
3. If you had been told four weeks earlier in October 2025, what would you have done differently?

## Words to avoid
Predicts cases. Forecasts the outbreak. Real-time. Automatic. Saves lives or money. Better than any named product. Validated by experts. "Pre-registered" for the six-year test. "Probability" for the classifier's score.
