---
type: "Research Topic"
title: "Token Counting Strategy"
description: "Decide how the workbench counts tokens: which profiles exist, what a tool's token total actually measures, and how counts stay comparable across scans."
tags: ["research", "RS-09"]
timestamp: "2026-08-20T13:47:37Z"
status: "done"
---

# Token Counting Strategy

## Objective

Decide how the workbench counts tokens: which profiles exist, what a tool's token total actually measures, and how counts stay comparable across scans.

## Why now / what it feeds

A footprint number is only useful if it is reproducible and comparable, which requires a stated counting method rather than an ad-hoc estimate.

## Scope

**In:** Token profiles, real BPE encodings versus heuristics, what is serialized before counting, and the counting-version stamp that keeps scans comparable.

**Out:** Provider pricing and runtime cost estimation.

## Deliverable

The counting strategy the token-counting module implements.

## Success criteria

Two scans produced under the same counting version are directly comparable, and a cross-version comparison is refused rather than silently wrong.
