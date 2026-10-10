# FluSentinel: pitch, demo and Q&A notes

Every number below comes from the Proof section of the site. Do not say a number that is not there.

## Pitch (3 minutes, no software on screen)
1. **Hook (20 s).** In one week of October 2025, influenza clusters in Malaysia went from 14 to 97, and 43 of them were in Selangor. (Ministry of Health statement, reported by Bernama, 9 Oct 2025.)
2. **Problem (30 s).** Public influenza figures run about four weeks behind. Anyone outside the Ministry is planning on month-old data.
3. **What we built (30 s).** A planner adds their own newest lab figures. The system returns an alert level, the kind of wave, a proposed action and the reason. A machine-learning classifier adds the chance of a rapid rise in the next four weeks.
4. **Proof (50 s).**
   - We first tried to forecast the level. Tested on 74 unseen weeks with rules frozen in advance, it lost to "same as last week" at all 8 horizons. We show that.
   - So we classify instead. Tested year by year across six years, the rapid-rise classifier caught 76% of rapid rises, against 38% for the simple rule. It raises more false alarms: its precision is 68% against 78%.
   - With current data the alert fired in the week the 2025 surge crossed the line. With public data the same alert fired four weeks later.
5. **Honest limits (25 s).** One surge. The classifier's event is common and those weeks were scored more than once. District shading is population, hospital beds are simulated, the user is a hypothesis.
6. **Ask (25 s).** One organisation willing to share weekly lab figures for a pilot, so we can keep a record of alerts made before the truth is known.

## Demo (4 minutes, replay link only)
1. Open the replay. Point at the date line: public data ends at week 37; today is week 41. Level is Green.
2. Point at the rapid-rise box: 56%, "likely", while the level is still Green.
3. Drag the four-week file onto the page (or press "Load those four weeks"). Level turns Orange, type A(H3), action changes, hospital plan changes.
4. Scroll to the simulator. Switch it on and drag "Weeks from now". Say: "these weeks are invented".
5. Scroll to Proof. Show table 3, the failed forecasts, then table 1.
6. If asked about bad data: load `demo_SIMULATED_bad_file.csv` in the replay and show the data warning.

## Likely questions
| Question | Answer |
|---|---|
| Where is the AI? | The classifier is the learned model. The alert level is a fixed rule, on purpose, so every alert can be explained. The forecast model lost to a naive baseline and we say so. |
| Is 76% recall good? | It catches about twice as many rises as the simple rule, at the cost of more false alarms (precision 68% against 78%). On one split it scored 66% and 86%; we quote the year-by-year figure because it is the more cautious. One country, a common event, so we call it a lead signal. |
| One surge is not evidence. | Correct. That is why we report counts, not rates, and why we started a record made in advance: on 10 Oct 2026 we committed what the system says about weeks 38 to 41, which are not published yet. |
| Why would the Ministry need this? | It does not; it has current data. The hypothesis is organisations without that feed. We have not yet tested it with one. |
| Are the thresholds official? | No. They are ours, computed from training weeks. An organisation's own data would need its own thresholds. |
| How do you stop false uploads? | In this demo uploads stay in the visitor's browser. Shared uploads would need logins and an audit trail first. |
| What does the simulator prove? | Nothing about the real world. It shows how the system responds. The factor effects are our assumptions. |

## Three questions for a real user (ask one person today)
1. When influenza is rising, what do you decide, and how often?
2. What figures do you look at now, and how old are they when you see them?
3. If you had been told four weeks earlier in October 2025, what would you have done differently?

## Words to avoid
Predicts cases. Real-time. Automatic. Saves lives or money. Better than any named product. Validated by experts.
