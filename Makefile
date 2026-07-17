# Waywright demo — one short command per moment. No long lines to memorize.
#   make help            list every target
#   make reset           dashboard → idle (recording start point)
#   make probes          LIVE: 3 judges (Zero pays, Steal clones, Local audits)
#   make gate            LIVE: ask the Pomerium policy gate to approve a merge
#   make zero-receipt    LIVE: full detail of the most recent real Zero charge (tx hash!)
#   make zero-what       what capability was bought (full spec)
#   make zero-runs       recent x402 charges (receipts)
#   make zero-wallet     current wallet balance
#   make serve           (re)start the gate + dashboard on :8081
#   make open            print the URLs to open in the browser
#
# Env is read from .env automatically by bun; PATH must include ~/.bun/bin and brew.
SHELL := /bin/bash
export PATH := $(HOME)/.bun/bin:/opt/homebrew/bin:$(PATH)

BASE         := http://localhost:8081
TARGET_DIR   ?= $(HOME)/codes/openclaw
STEAL_REPO   ?= irresi/hermes-agent
STATE        := .ouroboros/state.json
PROBES       := .ouroboros/probes.json
PR           ?= 2
GOAL         ?= find real bugs in openclaw, learn from how hermes-agent does it

# most-recent Zero run id, pulled live (no ID to memorize)
LAST_RUN = $$(zero runs --json --limit 1 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin)["runs"][0]["uid"])')

.PHONY: help reset probes gate zero-receipt zero-what teach zero-runs zero-wallet serve open demo

help:
	@echo "Waywright demo targets:"
	@grep -B1 -E '^[a-z-]+:' Makefile | grep -A1 '^##' | awk '/^##/{d=substr($$0,4)} /^[a-z-]+:/{split($$0,a,":");printf "  make %-14s %s\n",a[1],d}'

## dashboard → idle (clean recording start)
reset:
	@echo '{"phase":"idle","iteration":0,"log":[],"stolen":[]}' > $(STATE)
	@echo '{"goal":"","target":"","probes":{},"merged":[]}' > $(PROBES)
	@echo "✓ dashboard reset to idle — refresh $(BASE)/"

## LIVE 3-probe: Zero really pays, Steal really clones, Local really audits
probes:
	@echo "▶ running 3 parallel judges (Zero pays real \$$0.002, Steal+Local ~46s each)…"
	PROBE_TARGET_DIR="$(TARGET_DIR)" PROBE_STEAL_REPO="$(STEAL_REPO)" \
	PROBE_OUT="$(PWD)/$(PROBES)" PROBE_MAX_PAY=0.05 \
	bun run src/probes.ts "$(GOAL)"

## LIVE policy gate — ask Pomerium merge-gate to approve (ALLOW/DENY)
gate:
	@echo "▶ asking the policy gate to approve a merge…"
	@curl -s -X POST $(BASE)/gate/merge -H "content-type: application/json" \
	  -d '{"repo":"irresi/openclaw","pr":3,"iterations":1,"buildUrl":"live demo"}' \
	  | python3 -m json.tool

## LIVE full detail of the most recent real Zero charge — incl. on-chain tx hash
zero-receipt:
	@rid="$(LAST_RUN)"; echo "▶ latest Zero charge: $$rid"; echo; zero runs detail "$$rid"

## what capability was bought (full spec)
zero-what:
	@zero get javascript-node-js-linter-v8-static-analysis-e19fa853

## LIVE teach: turn a merged PR into a comic episode (this project's own pipeline)
teach:
	@echo "▶ teaching: PR #$(PR) → comic episode via extractors/pr…"
	bun extractors/pr/extract.ts irresi/openclaw $(PR) --out-dir episodes

## recent x402 charges (receipt list)
zero-runs:
	@zero runs --limit 8

## current wallet balance
zero-wallet:
	@zero auth whoami | grep -E "wallet|balance" || zero wallet balance

## (re)start gate + dashboard on :8081
serve:
	@pkill -f "gate/server.ts" 2>/dev/null; sleep 1; \
	set -a; source .env; set +a; export PROBE_OUT="$(PWD)/$(PROBES)" EPISODE_FILE="$(EPISODE)"; \
	nohup bun run gate/server.ts >/tmp/waywright-gate.log 2>&1 & \
	sleep 1; curl -s -o /dev/null -w "✓ gate + dashboard on $(BASE) (http %{http_code})\n" $(BASE)/

## print the URLs to open
open:
	@echo "dashboard : $(BASE)/"
	@echo "issues    : https://github.com/irresi/openclaw/issues?q=is%3Aissue"
	@echo "PR #2     : https://github.com/irresi/openclaw/pull/2"
	@echo "zero      : https://www.zero.xyz/profile"
