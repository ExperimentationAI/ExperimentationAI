Experiment Brief: Trial Length Optimization
Authors: Manus AI (as Lead Product Manager)

Stakeholders: [List of key stakeholders, e.g., Head of Product, Head of Growth, CMO, CTO]

Status: Draft


1. Executive Summary
This experiment is designed to determine the optimal free trial length to maximize long-term revenue and capital efficiency. We will test our current 14-day free trial against shorter 7-day and 3-day alternatives. The primary objective is to determine if a shorter trial can increase 1-Month Lifetime Value (LTV) per registrant or, failing that, confirm that a shorter trial can be implemented to improve cash velocity without causing a statistically significant decrease in LTV or harming user retention. This is a strategic decision to enhance our monetization efficiency, not merely a conversion rate optimization test. The results will directly inform our default trial policy and future monetization strategies.


2. Business Context & Strategic Rationale
Our current 14-day free trial has been the default offering but has never been empirically validated as the optimal duration. This extended trial period delays revenue realization and extends the payback period for customer acquisition costs (CAC). Furthermore, the long duration may dilute the sense of urgency for users to engage deeply with the product and convert to a paid subscription.

The central strategic question we are addressing is: Is urgency a significant and positive lever in our subscription model?

By testing shorter trial periods, we aim to understand the trade-offs between perceived value realization for the user and the business imperatives of faster revenue collection and improved cash flow. This experiment will provide critical data to inform our capital allocation strategy, shifting our focus from purely user acquisition to more efficient monetization of the existing user base.


3. Hypotheses
We will test the following hypotheses:

H1 (Primary): A shorter trial period (3-day or 7-day) will result in a 1-Month LTV per Registrant that is not statistically significantly lower than the 14-day control.
H2 (Guardrail): The 1-month paid retention rate for the shorter trial variants will not decrease by more than a relative 5% compared to the 14-day control.

If both hypotheses hold for a given variant, we will proceed with rolling out that variant as the new default trial length. Because improved cash velocity is a standalone business win, the bar for adoption is that a shorter trial does not hurt LTV — not that it must improve it.


4. Experiment Design
The experiment will be structured as an A/B/n test with the following variants:

Variant
Trial Length
Traffic Allocation
Registrants Required
Control
14-Day
20%
19,737
Variant A
7-Day
40%
39,474
Variant B
3-Day
40%
39,474
Total


100%
~98,685


No other changes will be made to the user experience, including pricing, packaging, or paywall messaging. The trial duration is the sole variable in this experiment.

Traffic allocation rationale: The control arm is intentionally under-weighted at 20% to limit downside exposure to our baseline revenue model. The two challenger variants each receive 40% to accelerate learning and ensure each arm reaches statistical significance independently.


5. Statistical Methodology
All sample size and runtime estimates are grounded in the following observed baseline metrics and statistical parameters.
Baseline Funnel Metrics
Metric
Rate
Registration → Trial
17%
Trial → Paid Conversion
42%
1-Month Paid Retention
64%
Baseline 1-Mo Retained Paid Rate (per Registrant)
4.57%


This end-to-end conversion rate (17% × 42% × 64% = 4.57%) serves as the proxy for our primary metric, 1-Month LTV per Registrant, for the purposes of sample size calculation.
Statistical Parameters
Parameter
Value
Rationale
Confidence Level
90% (α = 0.10, one-tailed)
Explicitly required; balances rigor with test speed.
Statistical Power
80% (β = 0.20)
Industry standard for product experiments.
Minimum Detectable Effect (MDE)
10% relative change
Smallest change that would be commercially meaningful.
Test Type
One-tailed z-test
We are testing for a directional outcome (no degradation).


Note on MDE: The 10% relative MDE is an assumption. If the business would act on a smaller change (e.g., 5%), the required sample size increases substantially and the runtime would extend significantly. We recommend confirming this threshold with finance before launch.
Sample Size & Runtime
Using a two-proportion z-test with the parameters above, the required sample per variant is 19,737 registrants. Because the control arm receives only 20% of traffic, it is the binding constraint, requiring a total of ~98,685 registrants across all variants.

Phase
Duration
Cohort fill period (at 2,000 registrants/day)
~50 days
14-day trial completion buffer
14 days
First paid cycle observation window
30 days
Total time to full readout
~94 days (~14 weeks)

Important Caveat: Retention Guardrail is Directional Only
The retention guardrail (H2) requires approximately 9,660 trial starters per variant to be independently powered at 90% confidence to detect a 5% relative decline. Our experiment design produces only ~3,356 trial starters per variant (19,737 registrants × 17% reg-to-trial rate). This means the retention guardrail cannot be treated as a statistically conclusive read within the experiment window. It will be monitored as a directional risk signal during the test. A dedicated 90-day post-launch retention analysis must be completed before any winning variant is rolled out globally.


6. Metrics & Success Criteria
We will use a combination of primary, leading, diagnostic, and guardrail metrics to evaluate the experiment's outcome.

Metric Category
Metric
Definition
Success Criteria
Primary Metric
1-Month LTV per Registrant
Total revenue collected from a user within 30 days of registration, divided by the total number of registrants in that cohort.
Not statistically significantly lower than the control (at 90% confidence).
Leading Indicator
Trial Conversion Rate
The percentage of users who convert from a free trial to a paid subscription.
Monitored for early directional signals.
Diagnostic Metrics
Registration → Trial Rate
The percentage of new registrants who start a free trial.
To understand any impact on top-of-funnel engagement.


Time-to-Conversion
The average time it takes for a user to convert to a paid subscription.
To measure the impact of urgency.


Activation Rate
% of trial users completing a key value-driving action during the trial window.
To assess whether users are realizing value in a shorter window.
Guardrail Metrics
1-Month Paid Retention
The percentage of paid users who remain subscribed after one month.
Must not decline by more than a relative 5% vs. control. (Directional only — see statistical note above.)


Refund Rate
The percentage of new paid users who request a refund.
Must not increase by more than 1 percentage point vs. control.


Support Tickets per Registrant
The number of support tickets created per 1,000 registrants in each variant.
To monitor for signs of user confusion or friction.


The decision to roll out a new variant will be based on a holistic assessment of these metrics, with the primary metric and guardrail metrics being the most critical.


7. Decision & Rollout Plan
Our decision framework is biased toward action. Given the significant business value of improved cash velocity, we will adopt the shortest trial period that does not cause a statistically significant drop in 1-Month LTV per Registrant, provided it also meets our retention and satisfaction guardrails.

If the 3-Day Trial Wins: Adopt the 3-day trial as the new default. Explore pricing elasticity and onboarding optimizations within this shorter urgency window. Gate global rollout on a 90-day retention follow-up.
If the 7-Day Trial Wins: Adopt the 7-day trial as the new default, treating it as the optimal balance between urgency and user value realization. Gate global rollout on a 90-day retention follow-up.
If the 14-Day Trial Wins: Maintain the current 14-day trial and shift focus to improving the onboarding experience to drive deeper engagement and conversion.


8. Risks & Mitigations
Risk
Mitigation
Users feel rushed, leading to increased churn.
Closely monitor 1-month paid retention and activation rates. Conduct a 90-day retention follow-up for the winning variant before global rollout.
Confusion around trial duration leads to a negative customer experience.
Monitor support ticket volume and sentiment for signs of confusion or frustration.
Misinterpreting revenue timing as structural growth.
Our primary metric, 1-Month LTV per Registrant, is designed to account for the full funnel and avoid this misinterpretation.
Retention guardrail is underpowered within the experiment window.
Treat the in-experiment retention read as directional only. Gate global rollout on a dedicated 90-day post-launch retention analysis.



9. Financial Impact Analysis
A successful outcome of this experiment has the potential for significant financial benefits. Even a flat outcome for Revenue per Registrant is a business win: by shortening the trial, we accelerate time-to-cash for every new customer, shortening the CAC payback period and improving overall cash flow without requiring additional marketing spend.

If a shorter trial also increases Revenue per Registrant, the impact compounds — annualized subscription revenue increases proportionally at current acquisition levels. Conversely, if the experiment shows degradation in LTV or retention, it will confirm that urgency is not a safe monetization lever for our business, allowing us to redirect resources to higher-impact initiatives such as onboarding improvements or pricing optimization.

This experiment informs capital allocation strategy, not just a UX configuration decision.

—------

Users are assigned to an XP by the experimentation platform (eg RevenueCat, Growthbook). Treatment inclusion events are logged to inclusion_logs. User events are logged to events. Each event and inclusion log contains a user_uuid that can be used to join.

User Events:

Registration completed
User successfully registered (this is when a user is assigned an experiment cohort)
Trial Started
User started a free trial 
Trial cancelled
User cancelled an active trial before trial period ended
Trial converted
User converted from trial to a paid subscription 
Subscription Renewed 
User renewed an active subscription
Subscription cancelled
User cancelled an active subscription 





Inclusion Logs Table:
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_key TEXT NOT NULL,
  variant_key TEXT NOT NULL,
  user_uuid TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  FOREIGN KEY(experiment_key) REFERENCES experiments(key)

Events table:
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  event_name TEXT NOT NULL,
  user_uuid TEXT NOT NULL,
  event_value REAL,
  event_params TEXT
