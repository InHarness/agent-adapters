<!-- anchor: ei2sw6e7 -->
# M10 — Image input

> One way to attach images to a prompt — `ImageInput` — materialized per adapter into whatever its SDK accepts (base64 block, URL, or a file path), degrading clearly where images aren't supported.

<!-- anchor: 9pq1vssl -->
## Purpose

Developers can include images in a prompt uniformly via `ImageInput`, and M10 materializes each image into the form the target SDK expects, instead of the consumer branching per engine. M10 owns the `ImageInput` shape and the per-adapter materialization + support matrix (one-home rule). Images flow through the contract as `ContentBlock` image blocks.

<!-- anchor: tf30g7hv -->
## Dependencies

| Module / Layer | Relation |
| --- | --- |
| L1 | `ContentBlock` image variant (`base64` or `url`); `ImageInput` in prompt input. |
| L2 | Owns the image support + materialization matrix per adapter. |
| L4 | Exports the `ImageInput` type and materialization helpers. |

<!-- anchor: r4yvss8u -->
## Unified Contract (L1)

- An image normalizes to `ContentBlock { type:'image', source: { type:'base64', mediaType, data } | { type:'url', url } }`.
- `ImageInput` is the consumer-facing shape that M10 converts into the above (or into a file path / native attachment) per adapter.

<!-- anchor: odwigr5h -->
## Capability & Degradation (L2)

M10 owns the **image support matrix** — which adapters accept images, and in which concrete form (inline base64 block, URL reference, or a materialized file path). When the target adapter cannot accept image input, M10 **warns** and skips the image rather than failing the run or sending a broken prompt.

<!-- anchor: yuhyvx9e -->
## Public API & Packaging (L4)

Exports the `ImageInput` type and the image materialization helpers from the package root.

<!-- anchor: 49bnpgns -->
## Edge cases

- Adapter accepts only file paths → an inline base64 `ImageInput` is materialized to a temp file and the path is passed.
- Adapter does not support images → warning + skip; the text prompt still runs.
- Oversized or unknown-media-type image → surfaced per adapter limits; never a silent corruption of the prompt.

<!-- anchor: j16mt0w3 -->
## Acceptance criteria

These verify uniform attachment and per-adapter materialization with graceful skip.

Real-model proof: the e2e `image` scenario (an image on input is materialized and described by the model) exercises this against a live model — scenario catalog in M12 (<section_ref anchor="xe2ecat1"/>); per-adapter coverage in the adapter files (<section_ref anchor="a01e2ecv"/>).

<tagged_list type="ac" tags="m10"/>
