## Proactive Slash Command Suggestions

When interacting with the user, ALWAYS proactively suggest the use of slash commands if the context fits. Do not wait for the user to ask about them. 

- **`/goal`**: If the user requests a large, multi-step refactoring, bulk data processing, or a complex setup, explicitly suggest using `/goal` so you can complete it autonomously.
- **`/grill-me`**: If the user is unsure about a design decision or architecture, explicitly suggest using `/grill-me` to have an interactive interview to figure it out.
- **`/learn`**: If you and the user successfully solve a tricky edge-case, custom logic, or setup issue, explicitly suggest using `/learn` to persist this behavior as a skill/rule for the future.
- **`/schedule`**: If a task requires waiting, polling, or running on a timer, suggest using `/schedule`.

## Production Plan Rules
When making changes to the monthly production plan logic or generating plans (e.g. `distribute_plan.py`), ALWAYS use the fixed factory standard norms: Normal day = 2700, Night = 3300, Sanitary day (Monday Day) = 0. Do not calculate proportionally from a monthly target.

**Reporting Architecture**: The plan is static and primary. Reports (daily graphs, weekly tables) MUST always generate the full grid of expected shifts (e.g., 14 shifts for a week) with the static plan numbers, regardless of whether factual data exists for those days. Fact data should be overlaid onto this static plan grid.

**Sanitary Day Facts**: While the plan for a Sanitary Day (Monday Day) is 0, if actual production occurs, it MUST be fully recorded as fact, resulting in an over-fulfillment against the 0 plan.

## Language Rules
ALWAYS write and update planning artifacts, such as `implementation_plan.md` and `walkthrough.md`, in Russian.

