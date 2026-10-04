# Project Instructions & Operational Handbook

You are the primary software engineering agent for this repository.
Your job is to build the application incrementally and leave the repository in a better, working state after every task.

---

## Autonomous Behavior
- Inspect files, run commands, create files, modify code, run tests, and diagnose failures autonomously without asking for confirmation for normal engineering decisions.
- Ask the user only when:
  - A product decision cannot reasonably be inferred.
  - Credentials or external secrets are required.
  - An irreversible destructive external action is required.
  - Two architectural choices have materially different product consequences.
- Otherwise, choose the simplest reasonable implementation and document the decision.

---

## Before Coding
Always:
1. Read [AGENTS.md](file:///home/syafiq/code/educk/AGENTS.md).
2. Read [STATUS.md](file:///home/syafiq/code/educk/STATUS.md).
3. Read relevant architecture and design documents in `docs/`.
4. Inspect existing code.
5. Search for existing implementations before creating new abstractions.

---

## Work in Milestones
- The project is developed strictly in sequential milestones (M0 through M17).
- Never attempt to implement multiple milestones in one pass.
- Complete one milestone, verify all acceptance criteria, update status, then proceed.

---

## Verification Checklist
After every implementation:
- Run relevant unit tests: `pnpm test` (or cargo test)
- Run TypeScript typecheck: `pnpm run build` or `pnpm tsc --noEmit`
- Run linter: `pnpm lint`
- Run Rust checks: `cargo check --manifest-path src-tauri/Cargo.toml`
- Run Rust clippy: `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
- Verify Android build when milestone impacts Android.

If a command fails due to an environmental dependency, distinguish environment issues from code failures clearly.

---

## Git Discipline
Make focused, conventional commits:
- `feat(scope): description`
- `fix(scope): description`
- `test(scope): description`
- `refactor(scope): description`
- `docs(scope): description`
- `chore(scope): description`

Before committing:
1. Inspect `git status` and `git diff`.
2. Ensure no credentials or keys are committed.
3. Ensure temporary files and build artifacts are excluded via `.gitignore`.

---

## Architecture Discipline
Do not introduce unnecessary architectural layers or over-engineer.
Prefer:
```
existing abstraction > small extension > new abstraction
```
Keep the application modular and cleanly separated.

---

## Agent Handoff Format
At the conclusion of each task or session, provide a structured report:
- **Completed work**: Specific capabilities implemented.
- **Files changed**: Exact list of files created or modified.
- **Verification results**: Status of tests, typecheck, lint, cargo checks.
- **Known limitations**: Any edge cases or pending items.
- **Next recommended task**: The immediate next step based on the roadmap.
