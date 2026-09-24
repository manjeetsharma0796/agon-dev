<!--
One task, one PR. The `board` job reads the lines below, so keep the labels exactly as written.
Delete nothing. If a line does not apply, write "n/a" and why.
-->

**Task:** T-

**Serves:** <!-- a judged criterion (Functionality, Potential impact, Novelty, UX, Open source,
Business plan) or a measured user metric. Copy the line from your TASKS.md row. -->

**Acceptance, and the number it hit:** <!-- the acceptance line from your row, then what you
measured. "p95 268 ms over 200 calls" not "fast enough". -->

**Evidence:** <!-- link to spikes/F*/result.json at a commit, the CI run, the staging URL, the
recording. `board` refuses `Status: done` without one. -->

**Finding:** <!-- what you discovered that nobody expected, with its number, the way monad did
("146 events became 14,237"). A task that discovered nothing usually did not look. Write "none"
only if you genuinely looked. -->

---

- [ ] `TASKS.md` row updated: `Status: in-review <this PR>`, and the branch matches `Branch:`
- [ ] I changed only files in my row's `Touches:` line
- [ ] `/ponytail-review` run
- [ ] `/code-review` at medium run
- [ ] `superpowers:verification-before-completion` run
- [ ] Money logic has its failing test first, committed before the implementation
- [ ] No em dashes or en dashes anywhere in the diff

**Dependency:** <!-- Required only if this PR adds a dependency. Say why the stdlib, a native
platform feature, or an already-installed package will not do. The `board` job fails a new
dependency without this line. -->

**Diff-size:** <!-- Required only if the diff is over 600 changed lines. Either split the PR or
state the reason here. -->

**Second reviewer needed?** <!-- CI cannot see these, so a human must. Tick any that apply and
name the reviewer. -->

- [ ] Money math (P&L, sizing, caps, costs)
- [ ] Builds a transaction or a Swig instruction, or touches the daemon or keys, so
      `/security-review` was also run
- [ ] Changes a frozen contract in `packages/core` (needs the owners of **both** sides to agree,
      and the fixtures change in this same commit)
- [ ] Changes docs another track reads
- [ ] A field name reaching the user or the agent changed (monad shipped "positions" that were
      trade flow, off by 67x)

**Reviewer:** <!-- name, or "CI only". The reviewer must not be the person who wrote the code
under test. -->
