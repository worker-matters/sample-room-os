# Planner Module

Owns planner-facing production visibility and sewing handoff operations.

Current MVP responsibilities:

- list active internal orders with readable current stage labels;
- list sewing-stage production workers;
- assign a cutting-finished order to a sewing worker and move the order into `sewing_doing`;
- keep planner data behind formal `planner` / boss / system owner access.
