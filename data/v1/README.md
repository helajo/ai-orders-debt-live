# AI Orders & Debt Map · public API v1 · 公开数据接口 v1

Stable, versioned files for programs. Every file here is rebuilt on each publish from the same graph the page
shows; the shape of these files only changes with a new version folder (`v2/`), fields are only ever added.
All amounts are nominal US dollars (`amount_usd`); `currency` / `amount_native` carry the original figure of a
non-USD deal. Text is UTF-8; dates are ISO `YYYY-MM-DD` (a day of `-01` can mean "day unknown", the text says so).

面向程序的稳定、带版本的数据文件。每次发布都从页面所用的同一张图重新生成；文件结构只在新版本目录（`v2/`）中改变，
字段只增不减。金额均为名义美元（`amount_usd`）；非美元交易的原币种和金额在 `currency` / `amount_native`。
文本为 UTF-8，日期为 ISO `YYYY-MM-DD`（`-01` 可能表示"日期不详"，说明文字会注明）。

## Files · 文件

| File | What · 内容 |
|---|---|
| `entities.json` | `{generated_at, version, licence, citation, entities: [...]}`. Each entity: `id`, `name`, `name_zh`, `group` (model_lab, hyperscaler, chip, neocloud, datacenter, energy, financier, spv, other), `ticker`, `country`, and `stats` (per-entity flows: `inflow_usd` / `outflow_usd` by kind, `guaranteed_in_usd` / `guaranteed_out_usd`, degree, counterparties). · 实体列表及每个实体的资金流统计。 |
| `edges.json` | `{generated_at, version, licence, citation, edges: [...]}`. Every curated deal exactly as in `graph.json`, plus `counted_usd` (what the totals count) and `contingent_usd` (a guarantee's face amount). · 全部已核实交易，附 `counted_usd`（计入总额的金额）和 `contingent_usd`（担保面额）。 |
| `stats.json` | `{generated_at, version, licence, citation, stats: {...}}`: totals by kind (`by_kind`), `total_usd`, `contingent_usd`, counts, `latest_announced`, and the counting-rule notes in both languages. · 汇总统计。 |
| `edges.csv` | All deals, one row each, columns below. `edges-<kind>.csv` holds one kind each (`order`, `investment`, `debt`, `lease`, `vendor_financing`, `guarantee`); an empty kind has the header only. No comment lines: the licence is this file. · 全部交易的 CSV，另有按类型拆分的文件。 |
| `changes.json` | `{generated_at, history_complete, last_commit, changes: [...]}`: the per-deal change log derived from the git history of the curated data, newest first, at most 2000 entries. Each entry: `date`, `commit`, `edge`, `kind` (`added`, `removed`, `changed`), `fields` (for `changed`: `{field: {from, to}}`; `sources` is counted, not diffed), `title_en`, `title_zh`. `history_complete: false` means the build saw only part of the history. · 每笔交易的变更记录（来自 git 历史）。 |
| `feed.xml` | Atom feed: one entry per commit that changed the data (last 50), bilingual title, the deal titles as the summary. · Atom 订阅：每次数据变更一条。 |
| `schema.json` | JSON Schema (draft 2020-12) for entities, edges and the files above. · 实体与交易的 JSON Schema。 |

CSV columns · CSV 列: `id, kind, subkind, from, to, from_name, to_name, amount_usd, counted_usd, amount_text,
currency, amount_native, announced, term, status, confidence, title_en, title_zh, summary_en, summary_zh,
source_urls, added_by`. `source_urls` joins the deal's source URLs with ` | `. Empty cells are null / not given.

## Direction and counting · 方向与计数规则

Money flows `from` → `to`: `order` buyer → seller; `investment` investor → investee; `debt` lender → borrower;
`lease` lessee → lessor; `vendor_financing` financier → beneficiary; `guarantee` guarantor → the protected party.

`counted_usd` = `amount_usd` when the deal has a disclosed amount, its `status` is not `cancelled` and its
`kind` is not `guarantee`; otherwise 0. `contingent_usd` = a live guarantee's `amount_usd`, otherwise 0.
`stats.total_usd` is the sum of `counted_usd`; `stats.contingent_usd` the sum of `contingent_usd`. A programme
(`part_of`) carries its amount once, on the umbrella or on its parts, never both. `confidence` is `confirmed`
(a filing or official release among the sources) or `reported` (major outlets); unverified machine extractions
are never published.

资金方向 `from` → `to`：`order` 买方→卖方；`investment` 投资方→被投方；`debt` 贷款方→借款方；`lease` 承租方→出租方；
`vendor_financing` 融资提供方→受益方；`guarantee` 担保方→被担保的债权人。`counted_usd`：有披露金额、状态不是
`cancelled`、类型不是 `guarantee` 的交易计入，否则为 0；`contingent_usd` 为有效担保的面额。总额 `total_usd` 是
`counted_usd` 之和，担保单独列为 `contingent_usd`。

## Licence and citation · 许可与引用

Data: Creative Commons Attribution 4.0 International (CC BY 4.0), see `../../LICENSE-DATA`. Figures are as
reported by the companies and outlets each deal cites; the filings and articles belong to their publishers.
Please cite: **AI Orders & Debt Map, helajo, <date>, https://helajo.github.io/ai-orders-debt-live/** (the date
is `generated_at`).

数据按 CC BY 4.0 许可（`../../LICENSE-DATA`）。引用格式：AI Orders & Debt Map, helajo, <日期>,
https://helajo.github.io/ai-orders-debt-live/

Descriptive only, not investment advice. 仅作描述，不构成投资建议。
