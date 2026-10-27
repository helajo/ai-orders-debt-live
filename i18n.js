/* AI orders & debt map: strings and formatters for English / 中文.
   Loaded before app.js; exposes window.I18N. */
(function () {
  "use strict";

  var STR = {
    en: {
      doc_title: "AI Orders & Debt Map",
      brand: "AI Orders & Debt Map",
      brand_sub: "Who owes whom among the AI giants: orders, investments and debt, monitored by Claude",
      kicker: "Live data · AI capital flows",
      live: "Live",
      stale: "Stale",
      sample: "Sample",
      snapshot: "Snapshot",
      snapshot_banner: "Archived snapshot of {d}. This view does not refresh.",
      snapshot_back: "Back to the live map",
      src_sec: "SEC EDGAR",
      src_news: "News feeds",
      src_fail: "{s}: last fetch failed",
      src_fail_short: "Last fetch failed",
      offline: "Offline",
      offline_since: "Offline · data from {t}",
      loading: "Loading…",
      retry: "Retry",
      updated: "Updated {t}",
      claude_on: "Auto-extraction on",
      claude_off: "Auto-extraction off",
      refreshing: "Refreshing…",
      load_error: "Couldn't load the latest data. Check your connection and try again.",
      check_now: "Check now",
      pop_built: "Map rebuilt",
      pop_monitor: "Monitor last ran",
      pop_monitor_note: "runs every 3 h",
      pop_sources: "Sources",
      pop_sources_v: "{sec} SEC filings · {news} news items",
      pop_next: "Next check of this page",
      in_min: "in {n} min",

      sum_orders: "Orders",
      sum_investments: "Investments",
      sum_debt: "Debt",
      sum_mix: "Mix by deal type",
      sum_caption: "{d} deals · {c} companies",
      sum_scope_filtered: "in current filter",
      sum_undisclosed: "+{n} with no disclosed amount",
      sum_undisclosed_short: "+{n} undisclosed",
      sum_hint: "Total of disclosed amounts",
      sum_foot: "Each deal is counted once; supply chains are not netted (OpenAI → Oracle and Oracle → NVIDIA both count).",
      kind_other: "Other financing",
      mix_seg_title: "{k} {v} · {n} deals",

      f_kinds: "Deal type",
      f_group: "Sector",
      f_group_all: "All sectors",
      f_min: "Minimum size",
      f_min_any: "Any size",
      f_from: "Start date",
      f_to: "End date",
      f_period: "Period",
      f_period_all: "All dates",
      f_period_365: "Last 12 months",
      f_period_90: "Last 90 days",
      f_period_2026: "2026",
      f_period_2025: "2025",
      f_period_custom: "Custom range",
      f_search: "Search",
      f_search_ph: "Find a company or deal (e.g. NVDA, 英伟达)",
      f_search_ph_short: "Find a company or deal (e.g. NVDA)",
      f_reset: "Clear all ({n})",
      f_more: "Filters",
      f_more_n: " · {n}",
      pill_group: "Sector: {v}",
      pill_q: "Search: {v}",
      pill_kinds: "Types: {n} of 6",
      pill_clear: "Remove filter: {v}",

      view_graph: "Graph",
      view_table: "Table",
      zoom_in: "Zoom in",
      zoom_out: "Zoom out",
      zoom_fit: "Fit to view",
      scope_n: "Top {n}",
      scope_all: "All",
      viz_scope: "{n} of {total} companies · {d} deals",
      viz_all: "{d} deals · {c} companies",
      legend: "Legend",
      legend_lines: "Lines",
      legend_circles: "Circles",
      legend_thin: "Thinnest = undisclosed or under $100M",
      legend_pool: "Dashed circle = pooled counterparty (bond market, unnamed lenders)",
      legend_arrow: "Arrow points to who receives the money: buyer → seller, investor → company, lender → borrower",
      graph_loading: "Loading the map…",
      graph_hint: "Drag to pan, scroll to zoom. Select a company or a line for details.",
      graph_hint_touch: "Use two fingers to move or zoom. Tap a company or a line for details.",
      graph_two_finger: "Use two fingers to move the map",
      graph_kbd: "Arrow keys move between companies, Enter opens details.",
      graph_aria: "Relationship graph: {n} companies, {d} deals. The Table view lists the same data.",
      empty_t: "No deals match",
      empty_clear_q: "Clear search “{q}”",
      empty_all_kinds: "Show all deal types",
      empty_reset: "Reset all filters",

      t_date: "Date",
      t_kind: "Type",
      t_from: "Payer",
      t_to: "Recipient",
      t_deal: "Deal",
      t_amount: "Amount (USD)",
      t_status: "Status",
      t_state: "Status",
      t_confidence: "Confidence",
      t_sources: "Sources",
      t_foot: "Disclosed total {v} across {n} of {d} deals",
      csv: "Download CSV ({n})",
      t_count: "{n} deals",
      sort_by: "Sort by",
      sort_date: "Newest",
      sort_amount: "Largest",
      sort_company: "Company A–Z",

      panel_overview: "Largest exposures",
      panel_overview_hint: "Select a company in the graph to see who it owes, who owes it, and every order and investment.",
      ov_empty: "Nothing to rank with these filters.",
      ov_key: "Bar = mix of deal types",
      ov_pool_note: "Pooled counterparties (bond markets, unnamed lenders) are not ranked.",
      ov_rank_by: "Rank by",
      rank_total: "Total",
      rank_borrowed: "Borrowed",
      rank_orders: "Orders placed",
      panel_close: "Close",
      p_total_in: "Money in",
      p_total_out: "Money out",
      p_deals: "Deals",
      p_owes: "Owes (borrowed from)",
      p_owed: "Is owed (lent to)",
      p_orders_placed: "Orders placed",
      p_orders_received: "Orders received",
      p_invest_made: "Investments made",
      p_invest_received: "Investments received",
      p_leases_paid: "Leases (pays rent to)",
      p_leases_received: "Leases (collects rent from)",
      p_vf_given: "Vendor financing given",
      p_vf_received: "Vendor financing received",
      p_guar_given: "Guarantees given",
      p_guar_received: "Guarantees received",
      p_none: "No deals in the current filter.",
      p_flow: "Money flows",
      p_subkind: "Instrument",
      p_term: "Term",
      p_announced: "Announced",
      p_amount_note: "As reported",
      p_sources: "Sources",
      p_select_from: "Show {name}",
      p_new: "New",
      p_bundle: "{n} deals",
      p_bundle_hint: "Deals of the same type between the same two companies are drawn as one line; its width is their total.",
      p_show_all: "Show all {n}",
      p_show_fewer: "Show fewer",
      cf_hint_confirmed: "Backed by a company filing or official release",
      cf_hint_reported: "Reported by a named outlet",

      latest: "Latest from the monitor",
      latest_news: "News",
      latest_filings: "SEC filings",
      latest_none_news: "No news items yet. The monitor adds them on its next run.",
      latest_none_filings: "No filings yet. The monitor adds 8-K and 10-Q items on its next run.",
      filing_items: "Item {items}",

      new_bar: "{n} new deals since your last visit",
      new_bar_one: "1 new deal since your last visit",
      new_show: "Show them",
      new_dismiss: "Dismiss",

      sr_selected: "Selected: {name}",
      sr_showing: "Showing {n} of {total} deals",
      aria_summary: "Totals",
      aria_filters: "Filters",
      aria_viz: "Relationship graph",
      aria_view: "View",
      aria_scope: "Companies shown",
      skip_graph: "Skip to graph",
      skip_past: "Skip the graph",

      footer_disclaimer: "For information only, not investment advice: this site describes deals and does not rate them. Amounts are nominal US dollars as disclosed by the companies or named outlets, and every deal links to its sources.",
      footer_built: "Built from public filings and news. Monitor runs on a schedule; this page re-checks every 5 minutes.",
      ago_now: "just now",
      ago_min: "{n} min ago",
      ago_hour: "{n} h ago",
      ago_day: "{n} d ago",
      never: "not yet",
      undisclosed: "Undisclosed",
      lang_label: "Language"
    },

    zh: {
      doc_title: "AI 巨头订单与债务关系图",
      brand: "AI 巨头订单与债务关系图",
      brand_sub: "AI 巨头之间谁欠谁：订单、投资与债务，由 Claude 持续监控",
      kicker: "实时数据 · AI 资本流向",
      live: "实时",
      stale: "数据较旧",
      sample: "示例",
      snapshot: "历史快照",
      snapshot_banner: "这是 {d} 的存档快照，不会自动刷新。",
      snapshot_back: "返回实时关系图",
      src_sec: "SEC EDGAR",
      src_news: "新闻源",
      src_fail: "{s}：上次抓取失败",
      src_fail_short: "上次抓取失败",
      offline: "离线",
      offline_since: "离线 · 显示 {t} 的数据",
      loading: "加载中…",
      retry: "重试",
      updated: "{t}更新",
      claude_on: "自动抽取已开启",
      claude_off: "自动抽取未开启",
      refreshing: "正在刷新…",
      load_error: "暂时无法加载最新数据，请检查网络后重试。",
      check_now: "立即检查",
      pop_built: "关系图更新",
      pop_monitor: "监控上次运行",
      pop_monitor_note: "每 3 小时运行一次",
      pop_sources: "来源",
      pop_sources_v: "SEC 文件 {sec} 份 · 新闻 {news} 条",
      pop_next: "本页下次检查",
      in_min: "{n} 分钟后",

      sum_orders: "订单",
      sum_investments: "投资",
      sum_debt: "债务",
      sum_mix: "交易类型构成",
      sum_caption: "{d} 笔交易 · {c} 家公司",
      sum_scope_filtered: "当前筛选",
      sum_undisclosed: "另有 {n} 笔未披露金额",
      sum_undisclosed_short: "{n} 笔未披露",
      sum_hint: "已披露金额合计",
      sum_foot: "按笔加总，上下游链条未抵消（如 OpenAI→甲骨文 与 甲骨文→英伟达 均计入）。",
      kind_other: "其他融资",
      mix_seg_title: "{k} {v} · {n} 笔",

      f_kinds: "交易类型",
      f_group: "行业",
      f_group_all: "全部行业",
      f_min: "最低金额",
      f_min_any: "不限金额",
      f_from: "开始日期",
      f_to: "结束日期",
      f_period: "时间",
      f_period_all: "全部时间",
      f_period_365: "近 12 个月",
      f_period_90: "近 90 天",
      f_period_2026: "2026 年",
      f_period_2025: "2025 年",
      f_period_custom: "自定义区间",
      f_search: "搜索",
      f_search_ph: "查找公司或交易（如 NVDA、英伟达）",
      f_search_ph_short: "查找公司或交易（如 NVDA、英伟达）",
      f_reset: "清除全部（{n}）",
      f_more: "筛选",
      f_more_n: " · {n}",
      pill_group: "行业：{v}",
      pill_q: "搜索：{v}",
      pill_kinds: "类型：6 选 {n}",
      pill_clear: "移除筛选：{v}",

      view_graph: "关系图",
      view_table: "表格",
      zoom_in: "放大",
      zoom_out: "缩小",
      zoom_fit: "适应窗口",
      scope_n: "前 {n}",
      scope_all: "全部",
      viz_scope: "{total} 家中的 {n} 家 · {d} 笔交易",
      viz_all: "{d} 笔交易 · {c} 家公司",
      legend: "图例",
      legend_lines: "连线",
      legend_circles: "圆圈",
      legend_thin: "最细 = 未披露或低于 1 亿美元",
      legend_pool: "虚线圆圈 = 资金池（债券市场、未具名贷款方等）",
      legend_arrow: "箭头指向收款方：买方 → 卖方，投资方 → 被投公司，贷款方 → 借款方",
      graph_loading: "正在加载关系图…",
      graph_hint: "拖动平移，滚轮缩放。点击公司或连线查看详情。",
      graph_hint_touch: "双指拖动或捏合缩放。轻点公司或连线查看详情。",
      graph_two_finger: "用双指移动和缩放关系图",
      graph_kbd: "方向键在公司之间移动，按回车查看详情。",
      graph_aria: "关系图：{n} 家公司，{d} 笔交易。表格视图提供相同数据。",
      empty_t: "没有符合条件的交易",
      empty_clear_q: "清除搜索“{q}”",
      empty_all_kinds: "显示全部交易类型",
      empty_reset: "重置全部筛选",

      t_date: "日期",
      t_kind: "类型",
      t_from: "出资方",
      t_to: "收款方",
      t_deal: "交易",
      t_amount: "金额（美元）",
      t_status: "状态",
      t_state: "状态",
      t_confidence: "可信度",
      t_sources: "来源",
      t_foot: "已披露合计 {v}（{d} 笔中的 {n} 笔）",
      csv: "下载 CSV（{n} 笔）",
      t_count: "{n} 笔交易",
      sort_by: "排序",
      sort_date: "最新",
      sort_amount: "金额最大",
      sort_company: "公司名称",

      panel_overview: "资金往来最大的公司",
      panel_overview_hint: "在关系图中点击一家公司，查看它欠谁、谁欠它，以及全部订单与投资。",
      ov_empty: "当前筛选下没有可排名的公司。",
      ov_key: "条形 = 交易类型构成",
      ov_pool_note: "债券市场、未具名贷款方等资金池不参与排名。",
      ov_rank_by: "排名依据",
      rank_total: "总额",
      rank_borrowed: "借入",
      rank_orders: "下达订单",
      panel_close: "关闭",
      p_total_in: "资金流入",
      p_total_out: "资金流出",
      p_deals: "交易",
      p_owes: "借款（欠谁）",
      p_owed: "放款（谁欠它）",
      p_orders_placed: "发出的订单",
      p_orders_received: "收到的订单",
      p_invest_made: "对外投资",
      p_invest_received: "获得投资",
      p_leases_paid: "租入（向对方付租金）",
      p_leases_received: "租出（向对方收租金）",
      p_vf_given: "提供的供应商融资",
      p_vf_received: "获得的供应商融资",
      p_guar_given: "提供的担保",
      p_guar_received: "获得的担保",
      p_none: "当前筛选下没有交易。",
      p_flow: "资金流向",
      p_subkind: "交易形式",
      p_term: "期限",
      p_announced: "公布日期",
      p_amount_note: "原始表述（英文）",
      p_sources: "来源",
      p_select_from: "查看{name}",
      p_new: "新",
      p_bundle: "{n} 笔交易",
      p_bundle_hint: "同一对公司之间同类型的多笔交易合并为一条线，线宽代表合计金额。",
      p_show_all: "显示全部 {n} 笔",
      p_show_fewer: "收起",
      cf_hint_confirmed: "有公司公告或官方发布佐证",
      cf_hint_reported: "具名媒体报道",

      latest: "监控最新动态",
      latest_news: "新闻",
      latest_filings: "SEC 文件",
      latest_none_news: "暂无新闻。监控下次运行时会添加。",
      latest_none_filings: "暂无文件。监控下次运行时会添加 8-K 与 10-Q 条目。",
      filing_items: "第 {items} 项",

      new_bar: "自上次访问以来新增 {n} 笔交易",
      new_bar_one: "自上次访问以来新增 1 笔交易",
      new_show: "查看",
      new_dismiss: "忽略",

      sr_selected: "已选择：{name}",
      sr_showing: "显示 {n} / {total} 笔交易",
      aria_summary: "汇总",
      aria_filters: "筛选",
      aria_viz: "关系图",
      aria_view: "视图",
      aria_scope: "显示的公司",
      skip_graph: "跳到关系图",
      skip_past: "跳过关系图",

      footer_disclaimer: "本站内容仅供参考，只作描述、不作评价，不构成任何投资建议。金额为公司公告或具名媒体披露的名义美元金额，每笔交易均附来源链接。",
      footer_built: "依据公开文件与新闻整理。监控程序定时运行；本页每 5 分钟自动检查更新。",
      ago_now: "刚刚",
      ago_min: "{n} 分钟前",
      ago_hour: "{n} 小时前",
      ago_day: "{n} 天前",
      never: "尚未运行",
      undisclosed: "未披露",
      lang_label: "语言"
    }
  };

  var KINDS = {
    order: { en: "Order", zh: "订单" },
    investment: { en: "Investment", zh: "投资" },
    debt: { en: "Debt", zh: "债务" },
    vendor_financing: { en: "Vendor financing", zh: "供应商融资" },
    lease: { en: "Lease", zh: "租赁" },
    guarantee: { en: "Guarantee", zh: "担保" }
  };

  var GROUPS = {
    hyperscaler: { en: "Hyperscalers", zh: "云巨头" },
    model_lab: { en: "AI labs", zh: "大模型公司" },
    chip: { en: "Chips", zh: "芯片" },
    neocloud: { en: "Neoclouds", zh: "新兴算力云" },
    datacenter: { en: "Data centers", zh: "数据中心" },
    energy: { en: "Energy", zh: "能源" },
    financier: { en: "Financiers", zh: "金融机构" },
    spv: { en: "SPVs & JVs", zh: "SPV 与合资公司" },
    other: { en: "Other", zh: "其他" }
  };

  var STATUS = {
    announced: { en: "Announced", zh: "已公布" },
    signed: { en: "Signed", zh: "已签署" },
    in_progress: { en: "In progress", zh: "进行中" },
    completed: { en: "Completed", zh: "已完成" },
    cancelled: { en: "Cancelled", zh: "已取消" },
    reported: { en: "Not yet announced", zh: "尚未官宣" }
  };

  var CONFIDENCE = {
    confirmed: { en: "Filing / official", zh: "公告确认" },
    reported: { en: "Press report", zh: "媒体报道" }
  };

  function tr(lang, key, vars) {
    var s = (STR[lang] && STR[lang][key]) || STR.en[key] || key;
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, k) {
        return vars[k] != null ? vars[k] : m;
      });
    }
    return s;
  }

  function label(map, lang, key) {
    var v = map[key];
    if (!v) return key ? String(key).replace(/_/g, " ") : "";
    return v[lang] || v.en;
  }

  function trimNum(x, digits) {
    var s = x.toFixed(digits);
    if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s;
  }

  /* number and unit of a USD amount, from one rounding rule:
     en ["$1.24", "T"], zh ["1.24", "万亿"] (the caller adds 美元) */
  function usdCore(n, lang) {
    var a = Math.abs(n);
    if (lang === "zh") {
      if (a >= 1e12) return [trimNum(n / 1e12, a >= 1e13 ? 1 : 2), "万亿"];
      if (a >= 1e8) {
        var yi = n / 1e8;
        return [Math.abs(yi) >= 100 ? String(Math.round(yi)) : trimNum(yi, 1), "亿"];
      }
      if (a >= 1e4) return [trimNum(n / 1e4, 0), "万"];
      return [String(Math.round(n)), ""];
    }
    if (a >= 1e12) return ["$" + trimNum(n / 1e12, a >= 1e13 ? 1 : 2), "T"];
    if (a >= 1e9) return ["$" + trimNum(n / 1e9, a >= 1e11 ? 0 : 1), "B"];
    if (a >= 1e6) return ["$" + trimNum(n / 1e6, 0), "M"];
    return ["$" + Math.round(n).toLocaleString("en-US"), ""];
  }

  /* $300B / 3000亿美元 (no space in Chinese). opts.bare drops 美元 where a column header carries the unit. */
  function fmtUSD(n, lang, opts) {
    opts = opts || {};
    if (n == null || !isFinite(n)) return tr(lang, "undisclosed");
    var c = usdCore(n, lang);
    if (lang === "zh") return c[0] + c[1] + (opts.bare ? "" : "美元");
    return c[0] + c[1];
  }

  /* {n, u} for big figures with a smaller unit: {n:"$1.24", u:"T"} / {n:"1.24", u:"万亿美元"} */
  function fmtUSDParts(n, lang) {
    if (n == null || !isFinite(n)) return { n: tr(lang, "undisclosed"), u: "" };
    var c = usdCore(n, lang);
    return { n: c[0], u: lang === "zh" ? c[1] + "美元" : c[1] };
  }

  /* instrument names: Chinese for the head term, else the English text marked as such */
  var SUBKIND_ZH = [
    ["convertible senior notes", "可转换优先票据"],
    ["senior notes", "优先票据"],
    ["corporate bonds", "公司债"],
    ["bond", "债券"],
    ["revolving credit facility", "循环信贷额度"],
    ["term loan", "定期贷款"],
    ["private credit", "私募信贷"],
    ["private-credit", "私募信贷"],
    ["delayed-draw", "延迟提款贷款"],
    ["delayed draw", "延迟提款贷款"],
    ["project finance", "项目融资"],
    ["finance lease", "融资租赁"],
    ["lease", "租赁"],
    ["cloud compute contract", "云算力合同"],
    ["compute", "算力合同"],
    ["gpu supply", "GPU 供货协议"],
    ["chip purchase", "芯片采购"],
    ["equity investment", "股权投资"],
    ["venture round", "风险投资轮"],
    ["funding round", "融资轮"],
    ["acquisition", "收购"],
    ["joint-venture", "合资公司股权"],
    ["joint venture", "合资公司股权"],
    ["warrant", "认股权证"],
    ["guarantee", "担保"],
    ["vendor financing", "供应商融资"]
  ].sort(function (a, b) { return b[0].length - a[0].length; });

  function subkind(lang, s) {
    if (!s) return { text: "", en: false };
    if (lang !== "zh") return { text: s, en: false };
    var low = String(s).toLowerCase();
    for (var i = 0; i < SUBKIND_ZH.length; i++) {
      if (low.indexOf(SUBKIND_ZH[i][0]) >= 0) return { text: SUBKIND_ZH[i][1], en: false };
    }
    return { text: s, en: true };
  }

  function region(lang, code) {
    if (!code) return "";
    try {
      return new Intl.DisplayNames([lang === "zh" ? "zh-CN" : "en"], { type: "region" }).of(code) || code;
    } catch (e) {
      return code;
    }
  }

  function parseISO(s) {
    if (!s) return null;
    var d = new Date(String(s).length <= 10 ? s + "T00:00:00Z" : s);
    return isNaN(d) ? null : d;
  }

  /* ISO day -> "Sep 10, 2025" / "2025年9月10日" (UTC, so a date never shifts a day). */
  function fmtDate(s, lang, opts) {
    var d = parseISO(s);
    if (!d) return s || "";
    if (opts && opts.iso) return d.toISOString().slice(0, 10);
    var o = { year: "numeric", month: opts && opts.short ? "short" : "short", day: "numeric", timeZone: "UTC" };
    if (opts && opts.noDay) delete o.day;
    try {
      return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", o).format(d);
    } catch (e) {
      return String(s).slice(0, 10);
    }
  }

  function fmtDateTime(s, lang) {
    var d = parseISO(s);
    if (!d) return s || "";
    try {
      return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
        year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short"
      }).format(d);
    } catch (e) {
      return d.toISOString();
    }
  }

  function ago(s, lang, now) {
    var d = parseISO(s);
    if (!d) return tr(lang, "never");
    var mins = Math.max(0, Math.round(((now || Date.now()) - d.getTime()) / 60000));
    if (mins < 1) return tr(lang, "ago_now");
    if (mins < 60) return tr(lang, "ago_min", { n: mins });
    var h = Math.round(mins / 60);
    if (h < 48) return tr(lang, "ago_hour", { n: h });
    return tr(lang, "ago_day", { n: Math.round(h / 24) });
  }

  window.I18N = {
    STR: STR,
    KINDS: KINDS,
    GROUPS: GROUPS,
    STATUS: STATUS,
    CONFIDENCE: CONFIDENCE,
    t: tr,
    kind: function (lang, k) { return label(KINDS, lang, k); },
    group: function (lang, g) { return label(GROUPS, lang, g); },
    status: function (lang, s) { return label(STATUS, lang, s); },
    confidence: function (lang, c) { return label(CONFIDENCE, lang, c); },
    fmtUSD: fmtUSD,
    fmtUSDParts: fmtUSDParts,
    subkind: subkind,
    region: region,
    fmtDate: fmtDate,
    fmtDateTime: fmtDateTime,
    ago: ago,
    parseISO: parseISO
  };
})();
