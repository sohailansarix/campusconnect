# AI service adapters

Every AI-shaped feature in CampusConnect is built against an interface in
[`types.ts`](./types.ts) and ships with a working **rule-based** implementation.
Dropping in an LLM later means implementing one interface and setting
`AI_DRIVER=llm` — no feature code changes.

## Why the rule-based implementations are not throwaway

They stay after an LLM is added, for three reasons:

1. **Reproducibility.** The Career Readiness score is shown to employers on the
   passport. A model that returns 71 today and 68 tomorrow on identical evidence
   is not acceptable there. `readiness.service.ts` is the permanent scoring
   path.
2. **Fallback.** Every AI call needs a path for a slow, rate-limited or down
   provider. `getAiServices()` already degrades to rule-based and logs loudly,
   rather than failing the request.
3. **Cold start.** Collaborative filtering needs engagement data that does not
   exist on day one. `recommendations` in `index.ts` is the cold-start engine.

## The contract

```ts
export interface AiServices {
  readonly driver: 'rule-based' | 'llm';
  readiness:       { calculate(input: ReadinessInput): Promise<ReadinessResult> };
  recommendations: RecommendationService;
  skillGap:        SkillGapService;
  resume:          ResumeSuggestionService;
  matching:        JobMatchingService;
  learningPath:    LearningPathService;
  interview:       InterviewService;
}
```

Features never import a concrete service. They call the facade:

```ts
import { ai } from '../../services/ai/index.js';

const readiness = await ai.readiness({ skills, projects, internships, ... });
```

## Rules every implementation must follow

| Rule | Why |
| --- | --- |
| **Deterministic.** Same input → same output. | Results are persisted to the passport and shown to employers as evidence. |
| **Explainable.** Every score and suggestion carries a `reason` derived from the input. | A number with no justification is worse than no number, especially to a student deciding what to do next. |
| **Non-throwing.** Failure degrades to empty, never a 500. | A recommendation panel that errors is worse than one that is briefly blunter. |
| **Bounded.** Suggestions are capped (readiness ≤ 6, answer improvements ≤ 3). | An overwhelming list does not get acted on. |

## Implementing an LLM driver

1. Create `llm/` alongside the rule-based files, e.g.
   `llm/readiness.service.ts` implementing the same interface.
2. Add a `LlmAiServices` object in `index.ts` and return it when
   `env.AI_DRIVER === 'llm'`.
3. Keep the rule-based object as the `catch` path inside each method:

```ts
export const llmResumeReview: ResumeSuggestionService = {
  review: async (input) => {
    try {
      return await callModel(input);
    } catch (error) {
      logger.warn('Resume review model failed, using rule-based scorer', { error: String(error) });
      return reviewResume(input);
    }
  },
};
```

### What each service would gain from a model

| Service | Rule-based today | LLM uplift |
| --- | --- | --- |
| `skillGap` | Set arithmetic over levels and weights | Infer required skills from a free-text target role; weight gaps by how often they appear in real postings |
| `resume` | Structural scoring: metrics, verbs, section depth | **Rewrite** weak bullets rather than describing the fix |
| `matching` | Exact skill-name overlap | Semantic similarity so "Power BI" ≈ "business intelligence tooling" |
| `learningPath` | Fixed prerequisite table + weight ordering | Sequence unusual role combinations the table does not cover |
| `interview` | Template bank + text structure heuristics | Assess technical correctness; generate follow-up questions |
| `recommendations` | Interest, gap and recency signals | Collaborative filtering over engagement data |

## Known limitations to disclose in the UI

- **`interview.evaluateAnswer` cannot judge correctness.** It measures structure,
  specificity and hedging. The UI must present the result as coaching on how the
  answer *lands*, not as a verdict on whether it is right — otherwise a student
  gets false confidence in a wrong answer.
- **`matching` uses exact skill-name matching.** A candidate with "Business
  Intelligence" does not match a posting requiring "Power BI" until the LLM
  driver lands. `MatchResult.factors` surfaces this, so the recruiter sees the
  reason rather than an unexplained low score.
- **Readiness thresholds are calibrated for a tier-2 Indian college pilot.**
  They are not percentiles. Recalibrate against real placement outcomes once the
  first cohort graduates.

## Configuration

```bash
AI_DRIVER=rule-based   # or 'llm'
ANTHROPIC_API_KEY=     # required when AI_DRIVER=llm
```

If `AI_DRIVER=llm` is set without an implementation registered, the API logs a
warning at first use and serves rule-based results — it does not fail.
