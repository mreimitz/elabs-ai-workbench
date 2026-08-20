---
type: "Roadmap Item"
title: "Overview → Detail restructure (Servers · Skills · Collections)"
description: "Replace the cramped 288px master-detail rail on Servers, Skills and Collections with a real overview page — a grouped card grid switchable to a grouped table — drilling into a full-width detail page whose breadcrumb leaf is a searchable entity switcher, built once as a generic EntityBrowser kit and used three times."
tags: ["roadmap", "RM-32"]
timestamp: "2026-08-20T19:45:25Z"
status: "planned"
---

# Overview → Detail restructure (Servers · Skills · Collections)

## Goal

Replace the cramped 288px master-detail rail on Servers, Skills and Collections with a real overview page — a grouped card grid switchable to a grouped table — drilling into a full-width detail page whose breadcrumb leaf is a searchable entity switcher, built once as a generic EntityBrowser kit and used three times.

## Why it matters

The rail cannot carry what it is asked to carry: a server row squeezes name, health, tokens, posture, transport, auth and endpoint into 288px, truncating names to noise, while costing every detail page 288px for a list looked at once. There is no fleet-level read anywhere in the section.

## Milestones

- [ ] EntityBrowser kit + BreadcrumbEntitySwitcher built and tested, no view wired
- [ ] Servers, Skills and Collections converted to overview → detail; rails deleted
- [ ] AppShell secondaryContent removed; README + CHANGELOG + DC delivery record updated

## Linked research

No linked research yet.
