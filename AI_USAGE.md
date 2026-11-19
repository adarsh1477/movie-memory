# AI Usage

- I used Claude as a planning and review partner: to break the assignment into stages, think through the data model, and talk through tradeoffs such as a database-backed cache vs Redis and an advisory lock vs an in-memory lock.
- I used Claude Code to write most of the implementation, one stage at a time, from prompts I wrote. I read each plan and summary before moving on, and I made the product decisions myself (both variants, one movie per user, no force-refresh parameter, and a 30s client cache that never outlives the 60s server window).
- I used Claude Code to write the tests (more than 560 across 28 suites), including real-Postgres tests for the advisory lock and authorization. The full suite was run before every commit.
- I tested the app by hand and used logs to check behavior: server cache hits and misses at the 60-second boundary, the browser cache in the console, the lock timing, and a production build.
- I fact-checked the AI-generated trivia myself. I found a false Dune: Part Two fact, which led me to ground facts in TMDB data and Wikipedia production notes instead of relying on model memory.
- I did not accept AI-generated code and docs blindly. I questioned design choices, asked for changes (for example the client cache rules and the history pagination), and caught bugs such as the history list growing past 5 items.
- Known limitation: LLM output is not independently verified. Grounding reduces false trivia but does not remove it.
