# Reading Companion — Infrastructure Reference

## Product and decision owners

[staged-roadmap.md](staged-roadmap.md) owns the ambient research partner framing: a reader explicitly
captures relevant material and asks a question, then keeps reading while research proceeds.
[thought-partner-spec.md](thought-partner-spec.md) owns the background-thread and delivery contract;
[DEFINITIONS.md](DEFINITIONS.md) owns domain vocabulary. Default narration and autonomous camera
capture are not the product baseline. A roadmap is not consent to capture or a claim of shipped capability.

This reference maps the implemented seams rather than duplicating prompts, schemas, SDK examples,
provider prices or a second roadmap. Resolve intended-behavior disagreements through the named product
owner; use implementation and tests as evidence of present behavior.

## Shared Core and thin clients

[core/README.md](core/README.md) owns run commands, REST/WebSocket messages, mock-versus-live
behavior, configured persistence paths and restart recovery. Core owns durable Sessions, Threads,
ResearchJobs and derived captures; clients own presentation and local device interaction.

| Concern | Implementation owner |
|---|---|
| Domain shapes and protocol validation | `core/src/types.ts` and Zod schemas |
| Session state and cursor | `core/src/sessionManager.ts`, `core/src/sessionStore.ts` |
| Threads, jobs and file persistence | `core/src/threadStore.ts`, `core/src/jobStore.ts`, `core/src/docStore.ts` |
| Capture extraction and storage | `core/src/capture.ts`; image bytes are discarded after extraction |
| Image quality/change cues and OCR | `core/src/imagePipeline/` |
| Queue, cancellation and recovery | `core/src/workQueue.ts` |
| Delivery etiquette and interruption level | `core/src/deliveryEngine.ts` |
| Voice transport seam | `core/src/voice/voiceSession.ts` and its adapters |
| Research and tool dispatch | `core/src/research/` |
| Client transport orchestration | `core/src/connection.ts`, `core/src/server.ts` |

Image detection plumbing does not authorize passive capture. v0 still requires an explicit gesture;
new recording/retention behavior requires the root consent boundary and perceptible state. Retrieved
page text is sensitive, untrusted evidence. Distinguish it from external sources and retain citations.

## Clients and evidence boundaries

[cross-platform-build-plan.md](cross-platform-build-plan.md) describes the client split. The
[web client](clients/web/README.md), [Meta clients](clients/meta-rbd/README.md),
[Android XR client](clients/android-xr/README.md) and [independent browser prototype](v0-web/README.md)
own their commands and surface evidence. Core, browser, emulator, physical-device and deployment
results are separate. Use synthetic captures for prototypes; inspect interruption, connectivity,
latency, battery and thermal constraints on the actual target when relevant and available.

## Privacy and content boundary

Use public-domain, user-owned, or user-generated material for v1 prototypes. This is a personal
research aid; do not redistribute extracted text. Make third-party OCR/page-text processing visible
in onboarding and recording state perceptible. Raw images/audio are not retained by default. A broad
consumer launch requires owner-led legal/privacy review; this architecture does not authorize it.

## Vendor swap layer

`core/src/voice/voiceSession.ts` owns the current interface; do not implement from a duplicated
illustrative SDK sketch. Research and capture have their own typed seams in Core.

## Cost model (rough, per active reading hour)

The earlier continuous-narration estimate was historical and does not price the current product.
Use the event-driven measurement method below; this heading remains only to preserve inbound links.

## Provider replacement and performance

Keep the voice/research/capture interfaces locally owned. Current adapters and package manifests
establish what is installed; a new provider, API shape, model or cost claim requires dated primary
sources and the shared LLM workflow. A provider announcement does not prove availability or parity.
Measure capture-to-answer and interruption latency on the relevant surface; use actual audio duration,
OCR calls, tokens, retries and ledger evidence when estimating operating cost. Do not reuse historical
narration-hour economics for an intermittent research task.

Useful experiments can compare delivery patterns, caching, OCR quality or replacement adapters while
preserving consent and source truth. Stop an unsupported conclusion at its missing evidence; continue
independent authorized work without inventing device proof or silently changing the product baseline.
