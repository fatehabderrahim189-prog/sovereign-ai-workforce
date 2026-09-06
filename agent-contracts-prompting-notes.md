# Notes: Structured Prompting and Agent Contracts — From the Digital Week (ASEPA) ChatGPT Webinar to the SAW Architecture

**Status:** Design notes based on external training attended Aug 13, 2026 (ASEPA "Digital Week" webinar on ChatGPT, led by Nazim Hachelaf). This is *not* an implementation report — no agent contracts have been coded or tested yet. It documents what was learned and how it maps onto the Sovereign AI Workforce (SAW) architecture, plus a concrete next step to test it.

## What was learned

The webinar's core point was that effective use of ChatGPT is not about writing longer prompts, but about structuring the interaction: define the context, the role the model should play, and the expected output, then iteratively refine based on response quality. For repeated tasks, this becomes a workflow — define the process, improve it against real outputs, test it with fresh inputs, and preserve the instructions that work for reuse.

## Relevance to SAW

SAW currently coordinates seven specialized agents through a sequenced orchestration pipeline, but individual agent instructions have not been formalized beyond generic task delegation (e.g., asking a specialist agent for "a summary"). The webinar's role → context → constraints → expected output framing suggests a concrete improvement: defining an explicit **contract** per agent rather than a generic instruction.

A contract, in this sense, would specify for each agent:
- its role and scope of responsibility,
- what context it receives,
- constraints it must respect,
- the expected output format,
- and the conditions under which it should defer or escalate to another agent (e.g., to the Executive Agent) instead of answering directly.

**Concrete example (design-level, not yet implemented):** instead of the Executive Agent asking the Finance or Research Agent for "a summary," it would provide the relevant business context, specify the decision the output needs to support, request structured evidence with stated uncertainties, and define the expected return format. The Executive Agent would then compare specialist outputs, identify conflicts or gaps, and produce a human-reviewable recommendation — rather than treating any single specialist's output as automatically correct.

## What this does NOT mean (explicit scope limit)

- No agent contracts have been written or tested. This is a design framework drawn from the webinar, applied on paper to SAW's existing seven-agent structure — it has not yet changed any code or prompt in the repository.
- No comparison exists yet between the current generic-instruction approach and a contract-based approach. Any claim of improved reliability or output quality would be unsupported until tested.
- The Executive Agent's role as described here (comparing specialist outputs, flagging conflicts, producing a human-reviewable recommendation) is a design intention consistent with SAW's existing human-in-the-loop approval-gate philosophy (as implemented in the SEAG experiment), not a new capability that has been built.

## Concrete next step (not yet done)

1. Pick one existing agent pair in SAW (e.g., Executive Agent → Research Agent) and write an explicit contract for the Research Agent following the role/context/constraints/output-format structure above.
2. Run the same underlying task twice: once with the current generic instruction, once with the structured contract, using identical input data.
3. Compare the two outputs against a simple, predefined rubric (e.g., does the output include stated uncertainties, is the format directly usable by the Executive Agent without reformatting, does it require a follow-up clarification).
4. Report the result honestly, including a negative result if the structured contract does not measurably improve the output — consistent with how negative results are already reported elsewhere in this project (Axiom-Zero, Experiment 2).

Until step 4 happens, this file remains a documented design consideration, not evidence of an implemented or validated improvement to SAW.
