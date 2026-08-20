---
type: "Research Topic"
title: "Unified Run Sessions"
description: "Work out why a run session looks and behaves differently depending on which backend executed it, and define one session contract that covers the API engine, the CLI subscription engine and the vendor assistant wrapper."
tags: ["research", "RS-03"]
timestamp: "2026-08-20T13:58:38Z"
status: "active"
---

# Unified Run Sessions

## Objective

Work out why a run session looks and behaves differently depending on which backend executed it, and define one session contract that covers the API engine, the CLI subscription engine and the vendor assistant wrapper.

## Why now / what it feeds

Every session surface in the app rendered a different status vocabulary, and long runs were being stopped by a wall-clock cap that did not match how agents work.

## Scope

**In:** The current state of the three backends, a proposed session contract, the open questions behind it, and what comparable products do.

**Out:** The implementation itself, which is planned and ledgered as a roadmap item.

## Deliverable

An evidence base and a concept for one session contract, feeding the locked D-US decisions.

## Success criteria

Every difference between the three backends is named, and the contract answers each one.
