# Production Plan Calculation

The production plan is now based on fixed standard norms:

## Shift Rules
- **Normal Day ("День"):** 2700 sheets per shift.
- **Night ("Ночь"):** 3300 sheets per shift.
- **Sanitary Day (Monday, "День"):** 0 sheets (full 11 hours downtime, 0 weight).

**Note:** Plans are no longer distributed proportionally from a monthly target (e.g., 160,000). The shop floor uses these fixed numbers (2700/3300/0) directly for all daily, weekly, and monthly calculations.

3. **Скрипты:**
   Для генерации плана используется скрипт `distribute_plan.py`.
