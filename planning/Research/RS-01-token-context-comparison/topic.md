---
type: "Research Topic"
title: "Token & Context Comparison — LLM Baseline Dataset"
description: "Establish a per-model baseline of context limits, tokenization, tool/MCP behavior, skills handling and token-cost accounting for the leading LLMs, and turn it into an executable MCP x model compatibility test suite."
tags: ["research", "RS-01"]
timestamp: "2026-08-20T13:58:38Z"
status: "active"
---

# Token & Context Comparison — LLM Baseline Dataset

## Objective

Establish a per-model baseline of context limits, tokenization, tool/MCP behavior, skills handling and token-cost accounting for the leading LLMs, and turn it into an executable MCP x model compatibility test suite.

## Why now / what it feeds

It is the ground truth the workbench's token-counting adapters, compatibility heatmap and advisor recommendations are built on.

## Scope

**In:** Six SaaS and five open-weight providers, latest three models each; MCP and tool limit taxonomy; the 31-test compatibility catalog; impact and per-model severity; the app's own test/check architecture.

**Out:** Provider pricing negotiation, non-MCP agent frameworks, and any limit that cannot be evidenced from vendor documentation.

## Deliverable

A machine-readable per-model dataset plus a comparison matrix, a test catalog and a severity model consumed by the compatibility feature.

## Success criteria

Every documented limit is traceable to a vendor source, the catalog validates against its schema, and the compatibility feature can resolve a verdict per model without further research.
