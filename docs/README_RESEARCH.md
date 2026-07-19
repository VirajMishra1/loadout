# README redesign research

Research was performed against the current default-branch READMEs on 2026-07-19 and
recorded at immutable commits so the references remain reproducible.

| Repository | README studied                                                                                                  | Principle adopted                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Ponytail   | [`16f2980`](https://github.com/DietrichGebert/ponytail/blob/16f29800fd2681bdf24f3eb4ccffe38be3baec6b/README.md) | Give the tool an unmistakable identity and memorable line.                   |
| uv         | [`1535a67`](https://github.com/astral-sh/uv/blob/1535a6767e5ebd77eac2ace0f6cf1a3edc5f681c/README.md)            | Define the product immediately, then show installation and observable proof. |
| bat        | [`7895139`](https://github.com/sharkdp/bat/blob/78951393e29bfd2f2a45f4326b9d2bb5e737dd2a/README.md)             | Demonstrate the terminal experience before exhaustive platform detail.       |
| fzf        | [`b163463`](https://github.com/junegunn/fzf/blob/b163463079e6254b8582b05acefcf187ec160d9b/README.md)            | Use recognizable branding and compact capability statements.                 |
| ripgrep    | [`227381d`](https://github.com/BurntSushi/ripgrep/blob/227381db0ee83dfa4341f1e27ff9617c0f5ad992/README.md)      | Prefer technical precision, scoped proof, and explicit limitations.          |
| mise       | [`126e775`](https://github.com/jdx/mise/blob/126e7755cc22e36c3d206b650de613951146b5e3/README.md)                | Pair a concise purpose with a real demo and copyable quickstart.             |
| Gum        | [`716d8b5`](https://github.com/charmbracelet/gum/blob/716d8b5d0221558f944b5a078dbbcca8572534fb/README.md)       | Teach one complete use case before listing the command surface.              |
| Starship   | [`8f28dfc`](https://github.com/starship/starship/blob/8f28dfcb1ca3242fba00a3cf98c10ee24605c3ed/README.md)       | Separate prerequisites, installation, and configuration.                     |

## Adopted

- A small original mark and one memorable product line.
- A proof-first opening with only CI, Node requirement, and license badges.
- A real terminal transcript that distinguishes preview from mutation.
- Installation and a disposable first success near the top.
- Short summaries with direct links to detailed technical evidence.
- Explicit boundaries beside the claims they qualify.

## Rejected

- Copying another project's mascot, artwork, prose, or layout.
- Comparative performance charts or speed claims; Loadout has no valid competitor
  benchmark.
- Screenshot-led presentation without a real product screenshot.
- `npm install --global loadout-ai@0.3.2`; that version is not currently published.
- Claims of universal safety, production readiness, human review, benchmarked sources,
  or native execution across every configured agent.
- Badge arrays, star counters, community/sponsor promotion, animations, and exhaustive
  command or platform tables on the front page.
